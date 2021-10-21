import json
import itertools

with open("bindables.json", "r") as f:
    bindables = json.load(f)["keys"].split(',')

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

    for chr in bindables:
        if chr not in bindings:
            if len(list(filter(lambda e: e.get("args", None) == chr, package["contributes"]["keybindings"]))) == 0:
                package["contributes"]["keybindings"].append(
                    {
                        "command": command,
                        "key": f"{setup_binding} {chr}",
                        "args": chr,
                    }
                )


def fix_binding():
    i = 0
    for bind in package["contributes"]["keybindings"]:
        if bind["command"] == "code-jumper.jumpTo":
            bind["key"] = f"{setup_binding} {bindables[i]}"
            i += 1

def save():

    with open("package.json", "w") as f:
        json.dump(package, f, indent=2)