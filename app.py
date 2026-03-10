from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, render_template


BASE_DIR = Path(__file__).resolve().parent


app = Flask(
    __name__,
    template_folder=str(BASE_DIR),
    static_folder=str(BASE_DIR / "static"),
    static_url_path="/static",
)


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
