function supportLanguages() {
    return ['auto', 'en', 'zh-Hans'];
}

function ocr(query, completion) {
    // 从插件配置中获取 API Key 和可选的 model 名称
    const { apiKey, model: userModel, apiUrl: userApiUrl, prompt: userPrompt } = $option;

    if (!apiKey) {
        completion({
            error: {
                type: "param",
                message: "The API key is not configured, Please set it in the plugin options.",
            }
        });
        return;
    }

    // Bob 的 query.image 是二进制数据，需要转换为 Base64 字符串
    const base64Str = query.image.toBase64();
    const header = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
    };

    // 使用兼容 OpenAI 格式的接口，方便调用。可通过插件选项 `apiUrl` 覆盖默认值。
    const url = (userApiUrl && userApiUrl.trim()) ? userApiUrl.trim() : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    const defaultPrompt = "Please identify the content in this image. If it is a mathematical formula, convert it to LaTeX format. If it is text, output it directly. Please output the result directly, without including any markdown markers or other unnecessary text.";
    const prompt = (userPrompt && userPrompt.trim()) ? userPrompt.trim() : defaultPrompt;
    const model = (userModel && userModel.trim()) ? userModel.trim() : "qwen-vl-max";


    const body = {
        model: model,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: "data:image/jpeg;base64," + base64Str
                        }
                    }
                ]
            }
        ]
    };

    // 发送 POST 请求
    $http.post({
        url: url,
        header: header,
        body: body,
        handler: function (resp) {
            const data = resp.data;

            // 错误处理
            if (!data || data.error) {
                completion({
                    error: {
                        type: "api",
                        message: data && data.error ? data.error.message : "API Request failed"
                    }
                });
                return;
            }

            // 解析结果
            if (data.choices && data.choices.length > 0) {
                let content = data.choices[0].message.content;

                // 移除开头的代码块标记
                content = content.replace(/^```latex\n?/, '')
                content = content.replace(/^```\n?/, '')

                // 移除结尾的代码快标记
                content = content.replace(/\n?```$/, '')

                // 移除 latex dollar 标记
                content = content.replace(/^\$+/, '').replace(/\$+$/, '')

                completion({
                    result: {
                        texts: [
                            {
                                text: content.trim()
                            }
                        ]
                    }
                });
            } else {
                completion({
                    error: {
                        type: "api",
                        message: "No valid response"
                    }
                });
            }
        }
    });
}
