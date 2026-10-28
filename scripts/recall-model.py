#!/usr/bin/env python3
"""Stage the embedding model that Orbito ships for Browsing recall.

Writes dist/recall-model/<model>/main/ with Google's EmbeddingGemma 300M
(q4 ONNX export from onnx-community, under the Gemma Terms of Use, see the
NOTICE written next to it), as Firefox's ML engine reads a model from a model
hub: the browser installs the directory as browser/orbito-models/
(browser/orbito-models/moz.build), and OrbitoEmbedder.sys.mjs opens it, so the
model works offline from the first run.

The export is changed in two ways, with the onnx package in a virtualenv of
its own (dist/recall-model-tools/):
- its weights, kept in a separate .onnx_data file, go into the .onnx file,
  since Firefox's native ONNX runtime loads a model from bytes only;
- its last_hidden_state output becomes its sentence_embedding (the pooled and
  projected embedding the model is trained for) repeated over the tokens, so
  that the mean pooling of Firefox's feature-extraction task gives exactly
  that embedding.

Downloads are pinned to a revision and checked against their sha256, and so
is the changed model; files already staged and matching are kept.

    scripts/recall-model.py
"""

import hashlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "onnx-community/embeddinggemma-300m-ONNX"
REVISION = "5090578d9565bb06545b4552f76e6bc2c93e4a66"
DOWNLOADS = {
    "config.json": "6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b",
    "tokenizer.json": "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47",
    "tokenizer_config.json": "3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a",
    "special_tokens_map.json": "2f7b0adf4fb469770bb1490e3e35df87b1dc578246c5e7e6fc76ecf33213a397",
    "added_tokens.json": "50b2f405ba56a26d4913fd772089992252d7f942123cc0a034d96424221ba946",
    "generation_config.json": "1fb1efd221c1ca88a736d1b36cb47d754c177677e222acb3b1e5424c5d664870",
    "onnx/model_q4.onnx": "ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043",
    "onnx/model_q4.onnx_data": "599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02",
}
MODEL_FILE = "onnx/model_q4.onnx"
CHANGED_SHA256 = "0e53d46cf568f512cf729888caec865407bea5d56bd98073f7044419022a6cd6"
# What changes the model, pinned so that it comes out the same.
TOOLS_PACKAGES = ["onnx==1.23.2", "protobuf==7.36.2"]

DOWNLOADED = ROOT / "dist/recall-model-src" / SOURCE / REVISION
TOOLS = ROOT / "dist/recall-model-tools"
# Firefox's model hub layout: <model>/<revision name>/<file>.
STAGED = ROOT / "dist/recall-model"
TARGET = STAGED / "orbito/embeddinggemma-300m/main"

NOTICE = """\
Gemma is provided under and subject to the Gemma Terms of Use found at
ai.google.dev/gemma/terms

This is EmbeddingGemma 300M, from the ONNX export at
https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX (revision
5090578d9565bb06545b4552f76e6bc2c93e4a66), changed by Orbito: its weights are
stored in the model file, and its last_hidden_state output is its
sentence_embedding output repeated over the input tokens.
"""


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download():
    for name, expected in DOWNLOADS.items():
        path = DOWNLOADED / name
        if path.exists() and sha256(path) == expected:
            continue
        url = f"https://huggingface.co/{SOURCE}/resolve/{REVISION}/{name}"
        print(f"Downloading {url}", flush=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
            with urllib.request.urlopen(url) as response:
                shutil.copyfileobj(response, tmp)
        actual = sha256(tmp.name)
        if actual != expected:
            Path(tmp.name).unlink()
            sys.exit(f"{name}: sha256 {actual}, expected {expected}")
        Path(tmp.name).replace(path)


def tools_python():
    python = TOOLS / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(TOOLS)], check=True)
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "-q",
            "--disable-pip-version-check",
            *TOOLS_PACKAGES,
        ],
        check=True,
    )
    return python


def convert(source, target):
    """Runs in the tools virtualenv, which has onnx."""
    import onnx
    from onnx import TensorProto, helper

    model = onnx.load(str(source))
    graph = model.graph
    for node in graph.node:
        node.output[:] = [
            "token_states" if name == "last_hidden_state" else name
            for name in node.output
        ]
        node.input[:] = [
            "token_states" if name == "last_hidden_state" else name
            for name in node.input
        ]
    graph.initializer.append(
        helper.make_tensor("orbito_axis1", TensorProto.INT64, [1], [1])
    )
    graph.node.extend(
        [
            helper.make_node("Shape", ["token_states"], ["orbito_shape"]),
            helper.make_node(
                "Unsqueeze", ["sentence_embedding", "orbito_axis1"], ["orbito_rows"]
            ),
            helper.make_node(
                "Expand", ["orbito_rows", "orbito_shape"], ["last_hidden_state"]
            ),
        ]
    )
    outputs = [o for o in graph.output if o.name == "last_hidden_state"]
    del graph.output[:]
    graph.output.extend(outputs)
    onnx.save_model(model, str(target), save_as_external_data=False)


def main():
    if sys.argv[1:2] == ["--convert"]:
        convert(Path(sys.argv[2]), Path(sys.argv[3]))
        return
    download()
    model = TARGET / MODEL_FILE
    if not (model.exists() and sha256(model) == CHANGED_SHA256):
        # Only this model is staged.
        shutil.rmtree(STAGED, ignore_errors=True)
        model.parent.mkdir(parents=True)
        print("Changing the model for Firefox's ML engine", flush=True)
        subprocess.run(
            [
                str(tools_python()),
                "-I",
                __file__,
                "--convert",
                str(DOWNLOADED / MODEL_FILE),
                str(model),
            ],
            check=True,
        )
        actual = sha256(model)
        if actual != CHANGED_SHA256:
            model.unlink()
            sys.exit(f"The changed model's sha256 is {actual}, not {CHANGED_SHA256}")
    for name in DOWNLOADS:
        if not name.startswith("onnx/"):
            shutil.copy(DOWNLOADED / name, TARGET / name)
    (TARGET / "NOTICE").write_text(NOTICE)
    size = sum(f.stat().st_size for f in TARGET.rglob("*") if f.is_file())
    print(f"Staged EmbeddingGemma in {TARGET} ({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
