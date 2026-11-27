"""Persistent SQLite job queue with stage tracking, cancellation, and crash recovery."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from threading import Lock
from typing import Callable
from uuid import uuid4

from knowledge_hub.library import Library

JOB_STATUSES = ("QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED")
JOB_STAGES = (
    "FETCHING",
    "EXTRACTING",
    "TRANSCRIBING",
    "TRANSLATING",
    "VALIDATING",
    "GENERATING_AUDIO",
    "ASSEMBLING_AUDIO",
    "SAVING",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    """Thread-pooled background job runner backed by SQLite state."""

    def __init__(self, lib: Library, max_workers: int = 2):
        self.lib = lib
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="kh-job")
        self._lock = Lock()
        self._cancelled: set[str] = set()
        self._recover_stale_jobs()

    def _recover_stale_jobs(self) -> None:
        """Mark leftover RUNNING/QUEUED jobs from prior crashes as FAILED safely."""
        with self.lib.connect() as db:
            db.execute(
                """UPDATE jobs
                   SET status='FAILED', error_message='Uygulama yeniden başlatıldığı için işlem durdu; önbellekten devam edebilirsiniz.',
                       finished_at=?
                   WHERE status IN ('RUNNING', 'QUEUED')""",
                (_now_iso(),),
            )

    def create_job(
        self,
        *,
        job_type: str,
        stage: str,
        item_id: str = "",
        provider: str = "",
        model: str = "",
        estimated_cost: float = 0.0,
        payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        jid = uuid4().hex
        now = _now_iso()
        with self.lib.connect() as db:
            db.execute(
                """INSERT INTO jobs(
                    id, item_id, job_type, status, stage, progress,
                    provider, model, estimated_cost, payload_json, created_at
                ) VALUES(?,?,?,'QUEUED',?,0,?,?,?,?,?)""",
                (
                    jid,
                    item_id,
                    job_type,
                    stage,
                    provider,
                    model,
                    estimated_cost,
                    json.dumps(payload or {}, ensure_ascii=False),
                    now,
                ),
            )
        return self.get(jid)

    def submit(self, job_id: str, fn: Callable[[str], dict[str, object] | None]) -> dict[str, object]:
        def _runner() -> None:
            self.update(job_id, status="RUNNING", started_at=_now_iso())
            try:
                result = fn(job_id) or {}
                if self.is_cancelled(job_id):
                    self.update(job_id, status="CANCELLED", finished_at=_now_iso())
                else:
                    self.update(
                        job_id,
                        status="COMPLETED",
                        stage="SAVING",
                        progress=1.0,
                        actual_cost=float(result.get("cost_usd", result.get("characters_billed", 0.0)) or 0.0),
                        finished_at=_now_iso(),
                    )
            except Exception as exc:
                if str(exc) == "JOB_CANCELLED" or self.is_cancelled(job_id):
                    self.update(job_id, status="CANCELLED", error_message="Kullanıcı tarafından iptal edildi.", finished_at=_now_iso())
                else:
                    self.update(job_id, status="FAILED", error_message=str(exc)[:500], finished_at=_now_iso())

        self._executor.submit(_runner)
        return self.get(job_id)

    def update(
        self,
        job_id: str,
        *,
        status: str | None = None,
        stage: str | None = None,
        progress: float | None = None,
        processed_segments: int | None = None,
        total_segments: int | None = None,
        cache_hits: int | None = None,
        actual_cost: float | None = None,
        error_message: str | None = None,
        started_at: str | None = None,
        finished_at: str | None = None,
    ) -> None:
        fields = []
        values: list[object] = []
        mapping = {
            "status": status,
            "stage": stage,
            "progress": progress,
            "processed_segments": processed_segments,
            "total_segments": total_segments,
            "cache_hits": cache_hits,
            "actual_cost": actual_cost,
            "error_message": error_message,
            "started_at": started_at,
            "finished_at": finished_at,
        }
        for col, val in mapping.items():
            if val is not None:
                fields.append(f"{col}=?")
                values.append(val)
        if not fields:
            return
        values.append(job_id)
        with self.lib.connect() as db:
            db.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id=?", tuple(values))

    def cancel(self, job_id: str) -> dict[str, object]:
        with self._lock:
            self._cancelled.add(job_id)
        job = self.get(job_id)
        if job["status"] == "QUEUED":
            self.update(job_id, status="CANCELLED", error_message="Başlamadan iptal edildi.", finished_at=_now_iso())
        return self.get(job_id)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled

    def get(self, job_id: str) -> dict[str, object]:
        with self.lib.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise KeyError(job_id)
        return dict(row)

    def list(self, limit: int = 40) -> list[dict[str, object]]:
        with self.lib.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))]

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False)
