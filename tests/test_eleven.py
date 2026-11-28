import pytest
from knowledge_hub.eleven import synthesize, MODELS

class Response:
    headers={"Content-Type":"audio/mpeg","character-cost":"5"}
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def read(self,n): return b"fake-mp3"

def test_cache(tmp_path):
    calls=[]
    def transport(req,timeout):
        calls.append(req)
        return Response()
    kwargs=dict(text="Merhaba",model=MODELS[0],voice="test",key="fake",output=tmp_path,allow_live=True,transport=transport)
    assert not synthesize(**kwargs)["cached"]
    assert synthesize(**kwargs)["cached"]
    assert len(calls)==1

def test_disabled(tmp_path):
    with pytest.raises(ValueError,match="explicit permission"):
        synthesize("Merhaba",MODELS[0],"test","fake",tmp_path)

def test_budget(tmp_path):
    for i in range(3):
        synthesize(str(i)*1000,MODELS[0],"test","fake",tmp_path,allow_live=True,transport=lambda *a,**k:Response())
    with pytest.raises(ValueError,match="budget"):
        synthesize("another",MODELS[0],"test","fake",tmp_path,allow_live=True,transport=lambda *a,**k:Response())
