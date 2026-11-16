FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libheif-examples libheif-plugin-x265 \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-pptx pillow reportlab pikepdf msoffcrypto-tool
WORKDIR /work
COPY make_fixtures.py .
ENTRYPOINT ["python", "make_fixtures.py"]
