import os
import zipfile

zip_path = os.path.join("public", "ai-buddy-extension.zip")
ext_dir = "extension"

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(ext_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, ext_dir)
            z.write(full, rel)

print(f"✅ Successfully packaged {ext_dir} into {zip_path}")
