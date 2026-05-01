# 多阶段：Node 打包前端 → Python 运行 FastAPI（Render / 任意容器）
FROM node:20-alpine AS frontend
WORKDIR /src
COPY web/frontend/package.json web/frontend/package-lock.json ./
RUN npm ci
COPY web/frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY web/backend/requirements.txt /app/web/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r /app/web/backend/requirements.txt

COPY personality_encoder /app/personality_encoder
COPY web/backend /app/web/backend
COPY web/__init__.py /app/web/__init__.py
COPY --from=frontend /src/dist /app/web/frontend/dist

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn web.backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
