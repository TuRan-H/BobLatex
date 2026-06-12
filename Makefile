# BobLatex 插件打包 Makefile
# 打包规范: https://bobtranslate.com/plugin/quickstart/pack.html
# 发布规范: https://bobtranslate.com/plugin/quickstart/publish.html
#
# 用法:
#   make            构建插件并更新 appcast.json
#   make build      同上
#   make pack       仅打包 .bobplugin（不更新 appcast）
#   make clean      删除生成的 .bobplugin 文件
#   make version    显示当前版本号
#   make help       显示帮助

SHELL      := /bin/bash
.DELETE_ON_ERROR:

# ── 源文件 ───────────────────────────────────────────────────────────────────

INFO_JSON  := src/info.json
SRC_FILES  := $(wildcard src/*.js src/*.json src/*.png)

# ── 读取版本号与标识符 ───────────────────────────────────────────────────────
# 优先 jq，回退 python3

ifneq ($(shell command -v jq 2>/dev/null),)
  _JSON_CMD = jq
  VERSION    := $(shell jq -r '.version'    $(INFO_JSON))
  IDENTIFIER := $(shell jq -r '.identifier' $(INFO_JSON))
else ifneq ($(shell command -v python3 2>/dev/null),)
  _JSON_CMD = python3
  VERSION    := $(shell python3 -c "import json,sys; d=json.load(open('$(INFO_JSON)')); print(d['version'])")
  IDENTIFIER := $(shell python3 -c "import json,sys; d=json.load(open('$(INFO_JSON)')); print(d['identifier'])")
else
  $(error 错误: 需要 jq 或 python3，请先安装其中之一)
endif

# 版本校验
ifeq ($(VERSION),)
  $(error 错误: 未在 $(INFO_JSON) 中找到有效的 version 值)
endif
ifeq ($(VERSION),null)
  $(error 错误: $(INFO_JSON) 中 version 为 null)
endif

PLUGIN_FILE := BobLatex-v$(VERSION).bobplugin
APPCAST     := appcast.json
GITHUB_BASE := https://github.com/TuRan-H/BobLatex/releases/download

# ── 目标 ────────────────────────────────────────────────────────────────────

.PHONY: all build pack appcast clean version help

all: build

## build: 打包插件并更新 appcast.json
build: pack appcast
	@echo ""
	@echo "════════════════════════════════════════"
	@echo "构建成功！"
	@echo "  插件文件: $(PLUGIN_FILE)"
	@echo "  SHA256  : $$(cat .sha256.tmp)"
	@echo ""
	@echo "后续步骤（发布到 GitHub）："
	@echo "  1. 将 $(PLUGIN_FILE) 上传到 GitHub Release（Tag: v$(VERSION)）"
	@echo "  2. 检查 appcast.json 中 url 和 desc 字段是否正确"
	@echo "  3. 将 appcast.json 推送到仓库根目录"
	@echo "  4. 确保仓库已设置 GitHub Topic: bobplugin"
	@echo "════════════════════════════════════════"
	@rm -f .sha256.tmp .ts.tmp

## pack: 仅打包 .bobplugin 文件
pack: $(PLUGIN_FILE)

$(PLUGIN_FILE): $(SRC_FILES)
	@echo "正在打包版本 v$(VERSION)（identifier: $(IDENTIFIER)）..."
	@if command -v zip &>/dev/null; then \
	    cd src && zip -r "../$(PLUGIN_FILE)" *.js *.json *.png; \
	elif command -v python3 &>/dev/null; then \
	    python3 -c "\
import zipfile, os, glob; \
zf = zipfile.ZipFile('$(PLUGIN_FILE)', 'w', zipfile.ZIP_DEFLATED); \
[zf.write(fp, os.path.basename(fp)) or print('  打包:', os.path.basename(fp)) \
 for pat in ['*.js','*.json','*.png'] for fp in sorted(glob.glob(os.path.join('src', pat)))]; \
zf.close()"; \
	else \
	    echo "错误: 找不到 zip 或 python3，无法打包"; exit 1; \
	fi
	@echo "插件文件已生成: $(PLUGIN_FILE)"
	@# 计算 SHA256 并缓存
	@$(call calc_sha256,$(PLUGIN_FILE)) > .sha256.tmp
	@echo "SHA256: $$(cat .sha256.tmp)"

## appcast: 更新 appcast.json
appcast: $(PLUGIN_FILE)
	@# 确保 SHA256 缓存存在
	@[ -f .sha256.tmp ] || $(call calc_sha256,$(PLUGIN_FILE)) > .sha256.tmp
	@# 生成时间戳（毫秒）
	@$(call gen_timestamp) > .ts.tmp
	@# 更新 appcast.json
	@[ -s $(APPCAST) ] || echo '{"identifier":"$(IDENTIFIER)","versions":[]}' > $(APPCAST)
	@if command -v jq &>/dev/null; then \
	    jq --arg version  "$(VERSION)" \
	       --arg sha256   "$$(cat .sha256.tmp)" \
	       --arg identifier "$(IDENTIFIER)" \
	       --argjson timestamp $$(cat .ts.tmp) ' \
	        .identifier = $$identifier | \
	        if (.versions | map(.version) | index($$version)) then \
	            .versions |= map( \
	                if .version == $$version then \
	                    .sha256 = $$sha256 | .timestamp = $$timestamp \
	                else . end) \
	        else \
	            .versions = [{ \
	                "version": $$version, \
	                "desc": "更新日志（请手动填写）", \
	                "sha256": $$sha256, \
	                "url": ("$(GITHUB_BASE)/v" + $$version + "/BobLatex-v" + $$version + ".bobplugin"), \
	                "minBobVersion": "0.5.0", \
	                "timestamp": $$timestamp \
	            }] + .versions \
	        end' $(APPCAST) > $(APPCAST).tmp && mv $(APPCAST).tmp $(APPCAST); \
	elif command -v python3 &>/dev/null; then \
	    python3 -c "\
import json; \
path='$(APPCAST)'; data=json.load(open(path)); \
data['identifier']='$(IDENTIFIER)'; \
ver='$(VERSION)'; sha=open('.sha256.tmp').read().strip(); ts=int(open('.ts.tmp').read().strip()); \
url='$(GITHUB_BASE)/v'+ver+'/BobLatex-v'+ver+'.bobplugin'; \
versions=data.get('versions',[]); \
found=next((v for v in versions if v.get('version')==ver),None); \
(found.update({'sha256':sha,'timestamp':ts}) if found \
 else versions.insert(0,{'version':ver,'desc':'更新日志（请手动填写）', \
     'sha256':sha,'url':url,'minBobVersion':'0.5.0','timestamp':ts})); \
data['versions']=versions; \
json.dump(data,open(path,'w',encoding='utf-8'),ensure_ascii=False,indent=2); \
print('appcast.json 已更新')"; \
	else \
	    echo "警告: 找不到 jq 或 python3，无法自动更新 appcast.json，请手动更新"; \
	fi

## clean: 删除构建产物
clean:
	@echo "清理生成的插件文件..."
	@rm -f BobLatex-v*.bobplugin .sha256.tmp .ts.tmp $(APPCAST).tmp
	@echo "清理完成。"

## version: 显示当前版本号
version:
	@echo "$(VERSION)"

## help: 显示帮助信息
help:
	@echo "BobLatex 构建系统"
	@echo ""
	@echo "用法: make [目标]"
	@echo ""
	@echo "目标:"
	@echo "  build    打包插件并更新 appcast.json（默认）"
	@echo "  pack     仅打包 .bobplugin 文件"
	@echo "  appcast  仅更新 appcast.json"
	@echo "  clean    删除构建产物"
	@echo "  version  显示当前版本号"
	@echo "  help     显示本帮助"
	@echo ""
	@echo "当前版本: v$(VERSION)"
	@echo "标识符:   $(IDENTIFIER)"

# ── 辅助函数 ─────────────────────────────────────────────────────────────────

# $(call calc_sha256,FILE) — 输出文件的 SHA256 到 stdout
define calc_sha256
$(if $(shell command -v shasum 2>/dev/null),\
    shasum -a 256 "$(1)" | awk '{print $$1}',\
$(if $(shell command -v sha256sum 2>/dev/null),\
    sha256sum "$(1)" | awk '{print $$1}',\
$(if $(shell command -v python3 2>/dev/null),\
    python3 -c "import hashlib; print(hashlib.sha256(open('$(1)','rb').read()).hexdigest())",\
    $(error 错误: 找不到 shasum / sha256sum / python3，无法计算 SHA256))))
endef

# $(call gen_timestamp) — 输出当前毫秒时间戳到 stdout
define gen_timestamp
$(if $(shell command -v python3 2>/dev/null),\
    python3 -c "import time; print(int(time.time()*1000))",\
    echo $$(( $$(date +%s) * 1000 )))
endef
