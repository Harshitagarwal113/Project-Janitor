# Project Janitor: Local AI (Ollama + Google Gemma) Integration

## 1. Overview
Project Janitor integrates optional local AI file classification through a locally running **Ollama** service. The system is designed to run completely offline on a developer's local machine with **zero cloud dependencies, zero telemetry, and zero paid API keys**.

## 2. Hardware Constraints & Model Selection
- **Target Hardware**: Windows laptop equipped with an NVIDIA GeForce RTX 3050 (4 GB VRAM) and 16 GB system RAM.
- **Recommended Model**: `gemma:2b` or `gemma2:2b`.
  - **Memory Footprint**: ~1.7 GB to 2.2 GB VRAM when quantized to Q4_K_M or Q4_0.
  - Fits comfortably within the 4 GB VRAM ceiling while leaving adequate headroom for Windows Desktop Window Manager (DWM) and display memory.
  - **Do NOT run larger variants** (e.g., `gemma:7b`, `gemma2:9b`, or `gemma2:27b`) on 4 GB VRAM, as they will spill into system RAM, drastically degrading latency and potentially causing CUDA out-of-memory errors.
  - **Single-Model Rule**: Only one model is loaded into VRAM at a time. Project Janitor never executes multiple concurrent model instances.

## 3. Manual Installation & Setup
In accordance with strict safety principles, Project Janitor **never automatically downloads models** and **never starts or stops the Ollama daemon process automatically**. The user retains full control.

### Step 1: Install Ollama for Windows
Download and install Ollama from the official website:
[https://ollama.com/download/windows](https://ollama.com/download/windows)

### Step 2: Pull and Verify the Gemma Model
Open Windows Terminal (PowerShell or Command Prompt) and pull the compatible lightweight Gemma model:
```powershell
ollama pull gemma:2b
```

To verify that the model is installed:
```powershell
ollama list
```
You should see `gemma:2b` listed with a size of ~1.7 GB.

### Step 3: Run the Ollama Server
If Ollama is not running in your system tray, launch it:
```powershell
ollama serve
```
By default, the Ollama HTTP API will be accessible at:
`http://127.0.0.1:11434`

## 4. Configuration
The backend configuration in `backend/app/core/config.py` provides the following defaults:
- `OLLAMA_BASE_URL`: `http://127.0.0.1:11434` (configurable via `.env`)
- `OLLAMA_MODEL`: `gemma:2b` (configurable via `.env`)
- `OLLAMA_TIMEOUT_SECONDS`: `30.0`
- `AI_MAX_CONTENT_CHARS`: `1500`

## 5. Security & Safety Invariants
1. **Untrusted Content Sandboxing**:
   File content is treated strictly as untrusted input. Content samples are enclosed in XML isolation boundaries:
   ```xml
   <untrusted_file_content>
   ... inert file content ...
   </untrusted_file_content>
   ```
   System prompts enforce that instructions inside `<untrusted_file_content>` must never be executed.
2. **Text-Only Content Sampling**:
   Only text-based formats (e.g. `.txt`, `.md`, `.json`, `.csv`, `.py`, `.js`, `.log`) are excerpted. Binary formats (`.png`, `.pdf`, `.zip`, `.exe`) are classified based strictly on filename, extension, and size metadata with no raw byte reading.
3. **Structured Pydantic Validation**:
   The Ollama API is called with `format: "json"` and `temperature: 0.0`. Every model response is strictly parsed and validated against `RawModelClassificationOutput` and `AIClassificationResponse`. Malformed fields or out-of-bounds confidence scores are rejected immediately.
4. **No Autonomous File Operations**:
   The AI classification engine is strictly read-only advisory metadata. It cannot delete, move, rename, or execute files.
