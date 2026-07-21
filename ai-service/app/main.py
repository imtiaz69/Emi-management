from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from .engine import analyze
from .security import require_service_key, safe_session_reference

app = FastAPI(
    title="FinanceLend Identity Cross-Validation",
    description="Compares supplied NID OCR, QR content, face similarity, and basic active liveness. It is not government verification.",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)


class AnalysisRequest(BaseModel):
    sessionId: str = Field(min_length=12, max_length=64)
    frontUrl: HttpUrl
    backUrl: HttpUrl | None = None
    livenessUrl: HttpUrl | None = None
    captureMode: str = Field(pattern="^(video|selfie|document_only)$")
    challenge: list[str] = Field(default_factory=list, max_length=4)


@app.get("/health")
def health():
    return {"status": "ok", "service": "identity-cross-validation", "officialGovernmentVerification": False}


@app.post("/v1/identity/analyze", dependencies=[Depends(require_service_key)])
async def analyze_identity(payload: AnalysisRequest):
    try:
        return await analyze(
            str(payload.frontUrl),
            str(payload.backUrl) if payload.backUrl else None,
            str(payload.livenessUrl) if payload.livenessUrl else None,
            payload.captureMode,
            payload.challenge,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        reference = safe_session_reference(payload.sessionId)
        raise HTTPException(status_code=500, detail=f"Analysis failed ({reference})") from error
