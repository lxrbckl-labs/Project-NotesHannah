# The demo generator: the fixture generator's base (fixtures/generator/Dockerfile) plus fonts for the
# handwriting, the whiteboard photo and the slide diagram.
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-humor-sans fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-pptx pillow reportlab
WORKDIR /work
COPY decks.py make_demo.py ./
ENTRYPOINT ["python", "make_demo.py"]
