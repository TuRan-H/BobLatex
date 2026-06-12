/**
 * BobLatex - 使用 OpenAI 兼容 API 进行 LaTeX 公式 OCR 识别的 Bob 插件
 *
 * 遵循 Bob 插件 OCR 规范：
 *   https://bobtranslate.com/plugin/quickstart/ocr.html
 *
 * 必须实现：
 *   1. supportLanguages()  - 获取支持的语言数组
 *   2. ocr()               - 执行文字识别
 *
 * 可选实现：
 *   3. pluginValidate()         - 自定义验证（在偏好设置显示「验证」按钮）
 *   4. pluginTimeoutInterval()  - 自定义文字识别超时时间（Bob 1.6.0+）
 *   5. supportBoundingBox()     - 声明支持位置信息（Bob 1.20.0+）
 */

// ─────────────────────────────────────────
// 1. 获取支持的语言数组（必须实现）
// ─────────────────────────────────────────

/**
 * 返回插件支持的语言列表。
 * Bob 会将 "auto" 理解为自动检测。
 * @returns {string[]}
 */
function supportLanguages() {
    return ['auto', 'en', 'zh-Hans'];
}

// ─────────────────────────────────────────
// 3. 声明支持位置信息（可选，Bob 1.20.0+）
// ─────────────────────────────────────────

/**
 * 本插件依赖 LLM 进行识别，无法返回文字在图片中的精确像素坐标，
 * 因此不声明支持 boundingBox，不出现在「原图翻译」的 OCR 服务列表。
 * 若未来接入支持坐标的 API，可将此函数改为 return true。
 * @returns {boolean}
 */
function supportBoundingBox() {
    return false;
}

// ─────────────────────────────────────────
// 4. 自定义文字识别超时时间（可选，Bob 1.6.0+）
// ─────────────────────────────────────────

/**
 * 由于 LLM Vision API 请求可能较慢，将超时时间设置为 90 秒。
 * 允许范围：30 ~ 300 秒，默认值为 60 秒。
 * @returns {number}
 */
function pluginTimeoutInterval() {
    return 90;
}

// ─────────────────────────────────────────
// 5. 自定义验证（可选，Bob 1.6.0+）
// ─────────────────────────────────────────

/**
 * 验证当前配置（API Key）是否有效。
 * 实现后，偏好设置界面将显示「验证」按钮。
 * @param {Function} completion
 */
function pluginValidate(completion) {
    var apiKey = $option.apiKey;
    var userApiUrl = $option.apiUrl;
    var userModel = $option.model;

    if (!apiKey || !apiKey.trim()) {
        completion({
            result: false,
            error: {
                type: 'secretKey',
                message: 'API Key 未填写，请在插件选项中填写 API Key。',
                troubleshootingLink: 'https://help.aliyun.com/zh/model-studio/get-api-key'
            }
        });
        return;
    }

    apiKey = apiKey.trim();

    var url = (userApiUrl && userApiUrl.trim())
        ? userApiUrl.trim()
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    var model = (userModel && userModel.trim()) ? userModel.trim() : 'qwen-vl-max';

    // 发送一个极小的文本请求来验证 Key 和端点的可用性
    var header = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
    };

    var body = {
        model: model,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Hi'
                    }
                ]
            }
        ],
        max_tokens: 1
    };

    $http.post({
        url: url,
        header: header,
        body: body,
        handler: function (resp) {
            if (resp.error) {
                completion({
                    result: false,
                    error: {
                        type: 'network',
                        message: '网络请求失败：' + (resp.error.message || '无法连接到 API 端点。'),
                        troubleshootingLink: 'https://help.aliyun.com/zh/model-studio/get-api-key'
                    }
                });
                return;
            }

            var data = resp.data;

            if (data && data.error) {
                var errCode = data.error.code || '';
                // 常见的鉴权错误码
                var isAuthError = (errCode === 'invalid_api_key') ||
                                  (errCode === 'Unauthorized') ||
                                  (errCode === 'authentication_error');
                completion({
                    result: false,
                    error: {
                        type: isAuthError ? 'secretKey' : 'api',
                        message: 'API 验证失败：' + (data.error.message || JSON.stringify(data.error)),
                        troubleshootingLink: 'https://help.aliyun.com/zh/model-studio/get-api-key'
                    }
                });
                return;
            }

            // 只要能收到 choices 或任何非错误响应，均视为验证成功
            if (data && (data.choices || data.id)) {
                completion({ result: true });
            } else {
                completion({
                    result: false,
                    error: {
                        type: 'api',
                        message: 'API 返回了意外的响应格式，请检查 API URL 和 Model 是否正确。'
                    }
                });
            }
        }
    });
}

// ─────────────────────────────────────────
// 内部辅助函数
// ─────────────────────────────────────────

/**
 * 从 Base64 字符串中检测图片的 MIME 类型
 * 通过魔数（magic number）识别常见图片格式
 * @param {string} base64Str
 * @returns {string}
 */
function detectMimeType(base64Str) {
    if (base64Str.startsWith('iVBORw0KGgo')) {
        return 'image/png';
    }
    if (base64Str.startsWith('/9j/')) {
        return 'image/jpeg';
    }
    if (base64Str.startsWith('R0lGOD')) {
        return 'image/gif';
    }
    if (base64Str.startsWith('UklGR')) {
        return 'image/webp';
    }
    // 默认回退到 jpeg
    return 'image/jpeg';
}

/**
 * 清理 LLM 返回的 LaTeX/Markdown 内容，移除多余的包裹标记
 * @param {string} content
 * @returns {string}
 */
function cleanContent(content) {
    var result = content;

    // 移除 ```latex ... ``` 代码块包裹（含可能的换行）
    result = result.replace(/^```latex\s*\n?/, '');
    result = result.replace(/\n?```\s*$/, '');

    // 移除剩余的 ``` 开头（其他语言标识符，如 ```tex）
    result = result.replace(/^```[a-z]*\s*\n?/, '');

    // 移除 $$ ... $$ 包裹（整段公式模式）
    result = result.replace(/^\$\$\s*\n?/, '');
    result = result.replace(/\n?\s*\$\$$/, '');

    // 移除单个 $ 包裹（行内公式模式）
    result = result.replace(/^\$+/, '').replace(/\$+$/, '');

    return result.trim();
}

/**
 * 构造并返回一个标准的错误 completion 对象
 * @param {Function} completion
 * @param {string} type  - Bob 错误类型: "param" | "api" | "network" | "unknown"
 * @param {string} message
 */
function completeWithError(completion, type, message) {
    completion({
        error: {
            type: type,
            message: message,
        }
    });
}

// ─────────────────────────────────────────
// 2. 执行文字识别（必须实现）
// ─────────────────────────────────────────

/**
 * OCR 主函数，每次进行图片识别时被 Bob 调用。
 * @param {object} query      - 识别请求对象
 * @param {$data}  query.image       - 图片二进制数据
 * @param {string} query.from        - 用户选中的源语言（可能是 "auto"）
 * @param {string} query.detectFrom  - Bob 推断的图片语言（非 "auto"）
 * @param {number} [query.pixelWidth]  - 图片像素宽度（Bob 1.20.0+）
 * @param {number} [query.pixelHeight] - 图片像素高度（Bob 1.20.0+）
 * @param {Function} completion - 识别完成后的回调
 */
function ocr(query, completion) {
    // 从插件配置中获取 API Key 和可选参数
    var apiKey = $option.apiKey;
    var userModel = $option.model;
    var userApiUrl = $option.apiUrl;
    var userPrompt = $option.prompt;

    // ── 参数校验 ──────────────────────────────

    // 验证 API Key（trim 后判空，防止纯空格也通过）
    if (!apiKey || !apiKey.trim()) {
        completeWithError(
            completion,
            'param',
            'API Key 未配置，请在插件选项中填写 API Key。'
        );
        return;
    }
    apiKey = apiKey.trim();

    // 验证图片数据是否存在
    if (!query.image) {
        completeWithError(completion, 'param', '未获取到图片数据，请重试。');
        return;
    }

    // ── 图片数据处理 ──────────────────────────

    // Bob 的 query.image 是二进制数据，转换为 Base64 字符串
    var base64Str;
    try {
        base64Str = query.image.toBase64();
    } catch (e) {
        completeWithError(completion, 'unknown', '图片数据转换失败：' + (e.message || e));
        return;
    }

    if (!base64Str || base64Str.length === 0) {
        completeWithError(completion, 'unknown', '图片数据为空，请重试。');
        return;
    }

    // 自动检测图片 MIME 类型，避免 PNG 被错误标记为 JPEG
    var mimeType = detectMimeType(base64Str);

    // ── 请求配置 ──────────────────────────────

    var url = (userApiUrl && userApiUrl.trim())
        ? userApiUrl.trim()
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    var defaultPrompt = 'Please identify the content in this image. If it is a mathematical formula, convert it to LaTeX format. If it is plain text, output it directly. Output the result only, without any markdown fences, dollar signs, or other surrounding markers.';
    var prompt = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : defaultPrompt;

    var model = (userModel && userModel.trim()) ? userModel.trim() : 'qwen-vl-max';

    var header = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
    };

    var body = {
        model: model,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: 'data:' + mimeType + ';base64,' + base64Str
                        }
                    }
                ]
            }
        ]
    };

    // ── 发送请求 ──────────────────────────────
    $http.post({
        url: url,
        header: header,
        body: body,
        handler: function (resp) {
            // 处理 HTTP/网络层面的错误（如超时、DNS 失败等）
            if (resp.error) {
                var errMsg = (resp.error && resp.error.message)
                    ? resp.error.message
                    : '网络请求失败，请检查网络连接。';
                completeWithError(completion, 'network', errMsg);
                return;
            }

            var data = resp.data;

            // 处理服务器返回的错误响应（如 401 Unauthorized、429 Too Many Requests）
            if (!data) {
                var statusCode = resp.response && resp.response.statusCode;
                var statusMsg = statusCode ? ('HTTP ' + statusCode) : '未知';
                completeWithError(completion, 'api', 'API 返回了空响应（' + statusMsg + '）。');
                return;
            }

            // 处理 API 业务层错误（如 invalid_api_key、quota_exceeded 等）
            if (data.error) {
                var apiErrMsg = data.error.message || JSON.stringify(data.error);
                var apiErrCode = data.error.code ? (' [' + data.error.code + ']') : '';
                completeWithError(completion, 'api', 'API 错误' + apiErrCode + '：' + apiErrMsg);
                return;
            }

            // ── 解析响应结果 ──────────────────────
            try {
                if (!data.choices || data.choices.length === 0) {
                    completeWithError(completion, 'api', 'API 返回了空的 choices 列表。');
                    return;
                }

                var choice = data.choices[0];
                if (!choice || !choice.message) {
                    completeWithError(completion, 'api', 'API 响应格式异常：缺少 message 字段。');
                    return;
                }

                var rawContent = choice.message.content;
                if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
                    completeWithError(completion, 'api', 'API 返回了空的识别结果。');
                    return;
                }

                var cleanedContent = cleanContent(rawContent);

                if (cleanedContent.length === 0) {
                    completeWithError(completion, 'api', '清理后的识别结果为空，原始内容：' + rawContent);
                    return;
                }

                // 按照 ocr result 规范返回结果：
                //   https://bobtranslate.com/plugin/object/ocrresult.html
                completion({
                    result: {
                        texts: [
                            {
                                text: cleanedContent
                            }
                        ]
                    }
                });

            } catch (e) {
                completeWithError(
                    completion,
                    'unknown',
                    '解析 API 响应时发生错误：' + (e.message || e)
                );
            }
        }
    });
}
