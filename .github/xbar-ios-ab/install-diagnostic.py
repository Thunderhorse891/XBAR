#!/usr/bin/env python3
"""Inject into a DISPOSABLE synthetic iOS simulator build only."""
import argparse
import pathlib
import re

parser = argparse.ArgumentParser()
parser.add_argument("index_html", type=pathlib.Path)
parser.add_argument("--synthetic-simulator-only", required=True, action="store_true")
args = parser.parse_args()

html = args.index_html
if html.name != "index.html" or "ios" in html.resolve().parts:
    parser.error("supply the intermediate web build index.html, not an Xcode source/packaged tree")
asset = html.with_name("xbar-ci-boot-diagnostic.js")
if asset.exists():
    parser.error("diagnostic already installed")
source = html.read_text()
tag = re.search(r'<script\b[^>]*\btype=["\']module["\']', source)
if not tag:
    parser.error("no initial module script found")
asset.write_text(pathlib.Path(__file__).with_name("startup.js").read_text())
html.write_text(source[:tag.start()] + '<script src="./xbar-ci-boot-diagnostic.js"></script>\n' + source[tag.start():])
