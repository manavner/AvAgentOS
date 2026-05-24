FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bridge.py .

ENV HERMES_CONTAINER=hermes
ENV PORT=8765
ENV TIMEOUT=120

EXPOSE 8765
CMD ["python", "bridge.py"]
