#!/bin/bash
# BobLatex 插件打包脚本
# 按照 https://bobtranslate.com/plugin/quickstart/pack.html 规范进行打包
# 并更新 appcast.json（https://bobtranslate.com/plugin/quickstart/publish.html）

set -e

# ── 读取版本号 ──────────────────────────────────────────────────────────────

if [ ! -f "src/info.json" ]; then
    echo "错误: src/info.json 文件不存在"
    exit 1
fi

# 优先使用 jq，回退到 python3
if command -v jq &>/dev/null; then
    version=$(jq -r '.version' src/info.json)
    identifier=$(jq -r '.identifier' src/info.json)
elif command -v python3 &>/dev/null; then
    version=$(python3 -c "import json; d=json.load(open('src/info.json')); print(d['version'])")
    identifier=$(python3 -c "import json; d=json.load(open('src/info.json')); print(d['identifier'])")
else
    echo "错误: 需要 jq 或 python3，请先安装其中之一"
    exit 1
fi

if [ -z "$version" ] || [ "$version" = "null" ]; then
    echo "错误: 未在 info.json 中找到有效的 version 值"
    exit 1
fi

PLUGIN_FILE="BobLatex-v${version}.bobplugin"
echo "正在构建版本 v${version}（identifier: ${identifier}）..."

# ── 打包插件 ────────────────────────────────────────────────────────────────
# 按照官方规范：进入插件根目录，选中所有文件进行压缩，不要压缩目录本身
# 支持 zip（macOS）和 python3（跨平台回退）

if command -v zip &>/dev/null; then
    (
        cd src
        zip -r "../${PLUGIN_FILE}" *.js *.json *.png
    )
elif command -v python3 &>/dev/null; then
    python3 - <<PYEOF
import zipfile, os, glob

src = 'src'
out = '${PLUGIN_FILE}'
patterns = ['*.js', '*.json', '*.png']

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for pat in patterns:
        for fp in glob.glob(os.path.join(src, pat)):
            arcname = os.path.basename(fp)
            zf.write(fp, arcname)
            print(f'  打包: {arcname}')
print(f'插件文件已生成: {out}')
PYEOF
else
    echo "错误: 找不到 zip 或 python3，无法打包"
    exit 1
fi

echo "插件文件已生成: ${PLUGIN_FILE}"

# ── 计算 SHA256 ──────────────────────────────────────────────────────────────
if command -v shasum &>/dev/null; then
    sha256=$(shasum -a 256 "${PLUGIN_FILE}" | awk '{print $1}')
elif command -v sha256sum &>/dev/null; then
    sha256=$(sha256sum "${PLUGIN_FILE}" | awk '{print $1}')
elif command -v python3 &>/dev/null; then
    sha256=$(python3 -c "
import hashlib
h = hashlib.sha256()
with open('${PLUGIN_FILE}', 'rb') as f:
    h.update(f.read())
print(h.hexdigest())
")
else
    echo "错误: 找不到 shasum / sha256sum / python3，无法计算 SHA256"
    exit 1
fi

echo "SHA256: ${sha256}"

# ── 生成时间戳（毫秒）─────────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
    timestamp=$(python3 -c "import time; print(int(time.time() * 1000))")
else
    timestamp=$(($(date +%s) * 1000))
fi

# ── 更新 appcast.json ────────────────────────────────────────────────────────
if [ ! -s "appcast.json" ]; then
    echo "{\"identifier\": \"${identifier}\", \"versions\": []}" > appcast.json
fi

if command -v jq &>/dev/null; then
    jq --arg version "$version" \
       --arg sha256 "$sha256" \
       --arg identifier "$identifier" \
       --argjson timestamp "$timestamp" '
        .identifier = $identifier |
        if (.versions | map(.version) | index($version)) then
            .versions |= map(
                if .version == $version then
                    .sha256 = $sha256 |
                    .timestamp = $timestamp
                else
                    .
                end
            )
        else
            .versions = [{
                "version": $version,
                "desc": "更新日志（请手动填写）",
                "sha256": $sha256,
                "url": ("https://github.com/TuRan-H/BobLatex/releases/download/v" + $version + "/BobLatex-v" + $version + ".bobplugin"),
                "minBobVersion": "0.5.0",
                "timestamp": $timestamp
            }] + .versions
        end
    ' appcast.json > tmp.json && mv tmp.json appcast.json
elif command -v python3 &>/dev/null; then
    python3 - <<PYEOF
import json, os

path = 'appcast.json'
with open(path) as f:
    data = json.load(f)

data['identifier'] = '${identifier}'

ver = '${version}'
sha = '${sha256}'
ts  = ${timestamp}
url = f'https://github.com/TuRan-H/BobLatex/releases/download/v{ver}/BobLatex-v{ver}.bobplugin'

versions = data.get('versions', [])
found = False
for v in versions:
    if v.get('version') == ver:
        v['sha256'] = sha
        v['timestamp'] = ts
        found = True
        break

if not found:
    versions.insert(0, {
        'version': ver,
        'desc': '更新日志（请手动填写）',
        'sha256': sha,
        'url': url,
        'minBobVersion': '0.5.0',
        'timestamp': ts
    })
    data['versions'] = versions

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print('appcast.json 已更新')
PYEOF
else
    echo "警告: 找不到 jq 或 python3，无法自动更新 appcast.json，请手动更新"
fi

echo ""
echo "════════════════════════════════════════"
echo "构建成功！"
echo "  插件文件: ${PLUGIN_FILE}"
echo "  SHA256  : ${sha256}"
echo "  时间戳  : ${timestamp}"
echo ""
echo "后续步骤（发布到 GitHub）："
echo "  1. 将 ${PLUGIN_FILE} 上传到 GitHub Release（Tag: v${version}）"
echo "  2. 检查 appcast.json 中 url 和 desc 字段是否正确"
echo "  3. 将 appcast.json 推送到仓库根目录"
echo "  4. 确保仓库已设置 GitHub Topic: bobplugin"
echo "════════════════════════════════════════"
