import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(title="Maya Python Microservice")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Faster Whisper Setup
# ---------------------------------------------------------
# We use device="cpu" and compute_type="int8" to optimize 
# for low memory and latency on a VPS environment without a GPU.
from faster_whisper import WhisperModel

MODEL_SIZE = "base"
print(f"Loading Faster-Whisper model '{MODEL_SIZE}' on CPU (int8)...")
# Initialize the model globally so it's ready for fast inference
whisper_model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
print("Whisper model loaded successfully.")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribes uploaded audio (WAV, M4A, MP3, WebM).
    Returns {"text": "transcribed string"}
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    # Save the uploaded file to a temporary location
    try:
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        # Transcribe using Faster-Whisper
        segments, info = whisper_model.transcribe(tmp_path, beam_size=1)
        
        # Join all segments
        text = "".join(segment.text for segment in segments).strip()
        
        return {"text": text}

    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temporary file
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ---------------------------------------------------------
# Tavily Search Setup
# ---------------------------------------------------------
from tavily import TavilyClient

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
tavily_client = TavilyClient(api_key=TAVILY_API_KEY) if TAVILY_API_KEY else None

class SearchRequest(BaseModel):
    query: str
    search_depth: str = "basic"
    max_results: int = 5

@app.post("/search")
async def search_tavily(request: SearchRequest):
    """
    Perform an internet search using Tavily API.
    """
    if not tavily_client:
        raise HTTPException(status_code=500, detail="TAVILY_API_KEY not configured")
    
    try:
        response = tavily_client.search(
            query=request.query,
            search_depth=request.search_depth,
            max_results=request.max_results
        )
        return response
    except Exception as e:
        print(f"Tavily search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Maya Python Microservice"}
