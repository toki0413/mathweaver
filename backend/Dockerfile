# syntax=docker/dockerfile:1
#
# MathWeaver backend image — Python 3.11 + FastAPI + Z3
# Multi-stage build: compile/install dependencies in a builder, ship a slim
# runtime image that does not carry build tooling.
#

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

# build-essential is kept only in the builder in case any dependency needs to
# fall back to a source build (z3-solver ships manylinux wheels, so this is
# mostly a safety net).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy project metadata first so dependency installation is cached separately
# from the application source.
COPY pyproject.toml ./

# pyproject.toml declares `readme = "README.md"`. Create a stub if the file is
# not present in the build context so metadata generation does not fail.
RUN test -f README.md || printf '# MathWeaver Backend\n' > README.md

# Install the declared runtime dependencies using a throw-away stub package,
# then uninstall the stub so only third-party dependencies remain in
# site-packages. This gives us a clean, cacheable dependency layer.
RUN mkdir -p mathweaver && touch mathweaver/__init__.py \
    && pip install --no-cache-dir . \
    && pip uninstall -y mathweaver \
    && rm -rf mathweaver mathweaver.egg-info

# Real application source (mathweaver/ package + data/ curriculum JSON files).
COPY . .

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

WORKDIR /app

# Third-party dependencies from the builder (fastapi, uvicorn, z3-solver, ...).
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Application source. PYTHONPATH=/app makes `import mathweaver` resolve to the
# source tree so that __file__-relative data/ loading keeps working.
COPY --from=builder /build /app

# Directory for the persisted SQLite database (mounted as a volume in compose).
RUN mkdir -p /app/data

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MATHWEAVER_HOST=0.0.0.0 \
    MATHWEAVER_PORT=8000

EXPOSE 8000

# Health check: probe the FastAPI /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/health', timeout=5)" || exit 1

# Run uvicorn as a module (avoids depending on the console-script shim).
CMD ["python", "-m", "uvicorn", "mathweaver.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
