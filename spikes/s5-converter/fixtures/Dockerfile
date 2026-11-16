FROM python:3.13-slim
RUN pip install --no-cache-dir python-pptx pillow reportlab pikepdf msoffcrypto-tool
WORKDIR /work
COPY make_fixtures.py .
ENTRYPOINT ["python", "make_fixtures.py"]
