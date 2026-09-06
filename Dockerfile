# Paso 1: Build del frontend
FROM node:22-slim AS web
# estp es para que pueda utilziar pnpm en vez de npm
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /web
COPY astro/web/ ./
RUN pnpm install --frozen-lockfile && pnpm run build

# Paso 2: Build del backend
FROM python:3.13-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir opencv-python-headless
COPY backend/ ./
COPY --from=web /web/dist /app/astro/web/dist

# correr como usuario no root
RUN useradd --create-home app && chown -R app /app
USER app

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
