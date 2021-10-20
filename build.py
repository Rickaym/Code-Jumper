import json
import itertools
from string import ascii_lowercase

with open("package.json", "r") as f:
    package = json.load(f)

setup_binding = r"ctrl+l"
command = "code-jumper.jumpTo"

def package_binding():
    bindings = "".join(
        itertools.chain(
            b["key"]
            for b in package["contributes"]["keybindings"]
            if b["command"] == command
        )
    )

    for chr in ascii_lowercase:
        if chr not in bindings:
            package["contributes"]["keybindings"].append(
                {
                    "command": command,
                    "key": f"{setup_binding} {chr}",
                    "when": "editorTextFocus",
                    "args": chr,
                }
            )


def fix_binding():
    i = 0
    for bind in package["contributes"]["keybindings"]:
        if bind["command"] == "code-jumper.jumpTo":
            bind["key"] = f"{setup_binding} {ascii_lowercase[i]}"
            i += 1

def save():

    with open("package.json", "w") as f:
        json.dump(package, f, indent=2)