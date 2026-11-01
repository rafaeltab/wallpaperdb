import json
import os
import sys
import time
from pathlib import Path

os.umask(0o077)
target = json.loads(sys.argv[1])
output = Path(sys.argv[2])


def identity(pid):
    raw = Path(f"/proc/{pid}/stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    return dict(pid=pid, birth=fields[19], state=fields[0],
                group=int(fields[2]), session=int(fields[3]))


def save(receipt):
    temporary = output.with_suffix(f".tmp-{os.getpid()}")
    with temporary.open("w") as file:
        json.dump(receipt, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, output)


receipt = dict(helper=identity(os.getpid()), target=target, began=time.monotonic())
save(receipt)  # Acquire this synthetic helper before waiting for the target.
output.with_name("reaping-guard-ready").write_text("ready")
deadline = time.monotonic() + 0.2
while True:
    actual = identity(target["pid"])
    assert actual["birth"] == target["startTicks"]
    assert actual["group"] == target["group"]
    assert actual["session"] == target["session"]
    if actual["state"] == "Z":
        receipt.update(qualified=True, actual=actual, ended=time.monotonic())
        save(receipt)
        break
    if time.monotonic() >= deadline:
        receipt.update(qualified=False, actual=actual, ended=time.monotonic())
        save(receipt)
        sys.exit(2)
    time.sleep(0.001)
