FROM python:3.13-slim
# libreoffice-* turn the generated .pptx/.docx into the old .ppt/.doc and the OpenDocument .odp/.odt fixtures.
RUN apt-get update && apt-get install -y --no-install-recommends libheif-examples libheif-plugin-x265 \
      libreoffice-writer libreoffice-impress fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-pptx python-docx pillow reportlab pikepdf msoffcrypto-tool
WORKDIR /work
COPY make_fixtures.py .
ENTRYPOINT ["python", "make_fixtures.py"]
