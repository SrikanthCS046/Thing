import base64
import io
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ENV = PROJECT_ROOT / ".env"
BACKEND_ENV = PROJECT_ROOT / "backend" / ".env"

load_dotenv(PROJECT_ENV)
load_dotenv(BACKEND_ENV, override=False)

app = FastAPI(title="VedaFlux AI Service", version="1.0.0")

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

_embedder = None


def get_embedder():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer(MODEL_NAME)
    return _embedder


def to_fixed_dim(values: list[float]) -> list[float]:
    if len(values) == EMBEDDING_DIM:
        return values
    if len(values) > EMBEDDING_DIM:
        return values[:EMBEDDING_DIM]
    return values + [0.0] * (EMBEDDING_DIM - len(values))


class ExtractRequest(BaseModel):
    filename: str
    mime_type: str = "text/plain"
    content_base64: str


class ChunkRequest(BaseModel):
    text: str
    size: int = Field(default=1600, ge=300, le=8000)
    overlap: int = Field(default=200, ge=0, le=1000)


class EmbedRequest(BaseModel):
    texts: list[str]


class RerankRequest(BaseModel):
    query: str
    chunks: list[dict[str, Any]]


class ChatRequest(BaseModel):
    question: str
    contexts: list[dict[str, Any]] = []
    conversationSummary: str | None = None
    history: list[dict[str, str]] = []


class SummaryRequest(BaseModel):
    kind: str
    title: str = ""
    text: str = ""
    previousSummary: str | None = None
    messages: list[dict[str, str]] = []


@app.get("/health")
def health():
    groq_ok = False
    groq_error = None

    if GROQ_API_KEY:
        try:
            client = groq_client()

            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "user", "content": "Reply with OK"}
                ],
                max_tokens=3,
            )

            groq_ok = bool(response.choices)
        except Exception as exc:
            groq_error = str(exc)

    return {
        "status": "ok",
        "embedding_model": MODEL_NAME,
        "embedding_dimensions": EMBEDDING_DIM,
        "groq_configured": bool(GROQ_API_KEY),
        "groq_model": GROQ_MODEL,
        "groq_ok": groq_ok,
        "groq_error": groq_error,
    }


@app.post("/extract")
def extract(req: ExtractRequest):
    raw = base64.b64decode(req.content_base64)
    name = req.filename.lower()
    mime = req.mime_type.lower()

    if "pdf" in mime or name.endswith(".pdf"):
        try:
            import fitz
            doc = fitz.open(stream=raw, filetype="pdf")
            text = "\n\n".join(page.get_text("text") for page in doc)
            return {"text": text.strip()}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"PDF extraction failed: {exc}")

    if "word" in mime or name.endswith(".docx"):
        try:
            from docx import Document
            doc = Document(io.BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs)
            return {"text": text.strip()}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"DOCX extraction failed: {exc}")

    if "json" in mime or name.endswith(".json"):
        return {"text": raw.decode("utf-8", errors="replace")}

    return {"text": raw.decode("utf-8", errors="replace")}


@app.post("/chunk")
def chunk(req: ChunkRequest):
    text = req.text or ""
    if not text.strip():
        return {"chunks": [{"content": "empty", "chunkIndex": 0, "metadata": {}}]}
    size = req.size
    overlap = min(req.overlap, size // 2)
    chunks = []
    start = 0
    index = 0
    while start < len(text):
        end = min(len(text), start + size)
        content = text[start:end].strip()
        if content:
            chunks.append({"content": content, "chunkIndex": index, "metadata": {"source": "ai-service"}})
            index += 1
        if end >= len(text):
            break
        start = end - overlap
    return {"chunks": chunks}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": []}
    model = get_embedder()
    vectors = model.encode(req.texts, normalize_embeddings=True).tolist()
    return {"embeddings": [to_fixed_dim([float(x) for x in vector]) for vector in vectors]}


def lexical_score(query: str, text: str) -> float:
    q = set(re.findall(r"\w+", query.lower()))
    t = set(re.findall(r"\w+", text.lower()))
    if not q or not t:
        return 0.0
    return len(q & t) / max(1, len(q))


@app.post("/rerank")
def rerank(req: RerankRequest):
    result = []
    for chunk in req.chunks:
        item = dict(chunk)
        lexical = lexical_score(req.query, str(item.get("content", "")))
        base = float(item.get("score", 0.0))
        item["score"] = (0.75 * base) + (0.25 * lexical)
        result.append(item)
    result.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
    return {"chunks": result}


def groq_client():
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")
    from openai import OpenAI
    return OpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")


def source_block(contexts: list[dict[str, Any]]) -> str:
    blocks = []
    for i, c in enumerate(contexts[:8], 1):
        blocks.append(f"[SOURCE {i}] {c.get('documentName','unknown')}\n{c.get('content','')[:8000]}")
    return "\n\n".join(blocks)


@app.post("/chat")
def chat(req: ChatRequest):
    try:
        client = groq_client()
        system = """You are VedaFlux, an AI-powered developer onboarding assistant. Answer using the supplied project evidence first. Explain code, functions, commits, PR decisions, Jira work, and Slack discussions in simple but technically accurate language. Do not invent facts. When evidence is missing, say what is not available. Prefer concise structured explanations and mention source numbers like [1], [2] when useful."""
        history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in req.history[-10:]]
        memory = req.conversationSummary or "(none)"
        user = f"Conversation memory:\n{memory}\n\nProject evidence:\n{source_block(req.contexts)}\n\nQuestion:\n{req.question}"
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": user}],
            temperature=0.2,
            max_tokens=1800,
        )
        answer = completion.choices[0].message.content or "I could not generate an answer."
        return {"answer": answer}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}")


@app.post("/summarize")
def summarize(req: SummaryRequest):
    try:
        client = groq_client()
        if req.kind == "conversation":
            source = "\n".join(f"{m.get('role')}: {m.get('content','')}" for m in req.messages[-20:])
            prompt = f"Summarize this developer-assistant conversation for future context. Preserve decisions, unresolved questions, entities, repositories, issues, and important technical facts. Prior summary: {req.previousSummary or '(none)'}\n\n{source}"
        else:
            prompt = f"Create a compact factual knowledge summary for a developer onboarding system. Type: {req.kind}. Title: {req.title}. Evidence:\n{req.text[:14000]}"
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "system", "content": "You summarize software-project evidence. Never invent information."}, {"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=1200,
        )
        return {"summary": completion.choices[0].message.content or ""}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Summary request failed: {exc}")
