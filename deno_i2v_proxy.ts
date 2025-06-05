// deno_i2v_proxy v3

// deno_i2v_proxy v3 主要修改内容：
// 1. 处理Fal.ai提交请求时HTTP 413 Payload Too Large错误：
//    - 当客户端上传的图片过大（导致发送给Fal.ai的请求体超过4MB限制）时，脚本现在会捕获此413错误。
//    - 并向客户端（例如Cherry Studio）返回一个清晰的错误提示，告知图片文件过大。
// 2. 增强流式响应中控制器操作的健壮性：
//    - 在流式响应的 `controller.enqueue()` 和 `controller.close()` 操作周围添加了 `try...catch` 块。
//    - 目的是捕获当客户端（例如Cherry Studio）可能提前断开连接后，再对流控制器进行操作时可能抛出的
//      `TypeError: The stream controller cannot close or enqueue` 错误。
//    - 这可以防止Deno脚本因客户端的意外断开而记录未捕获的异常，并尝试更优雅地处理这种情况。
// 3. 轮询超时参数调整：(此项已在v2中修改，v3保留)
//    - `maxAttempts` for video models 保持为 `150` (配合4秒的轮询间隔，提供约10分钟的轮询时间)。
// 4. Fal.ai状态轮询中HTTP 202 Accepted状态码处理：(此项已在v2中修改，v3保留)
//    - 脚本会正确处理Fal.ai在任务进行中（`IN_PROGRESS` 或 `IN_QUEUE`）时返回的 `202 Accepted` HTTP状态码。


const falApiKeysEnv = Deno.env.get("FAL_API_KEYS");
let AI_KEYS = [];
if (falApiKeysEnv) {
    AI_KEYS = falApiKeysEnv.split(',').map(key => key.trim()).filter(key => key.length > 0);
    if (AI_KEYS.length === 0) {
        console.warn("FAL_API_KEYS environment variable is set but contains no valid keys after parsing. Please ensure it's a comma-separated list of non-empty keys.");
    } else {
        console.log(`Successfully loaded ${AI_KEYS.length} FAL API Key(s) from environment variable.`);
    }
} else {
    console.warn("FAL_API_KEYS environment variable not set. AI functionality will be severely limited or fail. Please set it in your Deno Deploy project settings.");
}

const customAccessKeyEnv = Deno.env.get("MY_CUSTOM_ACCESS_KEY");
let CUSTOM_ACCESS_KEY = "";
if (customAccessKeyEnv) {
    CUSTOM_ACCESS_KEY = customAccessKeyEnv;
    console.log("Successfully loaded MY_CUSTOM_ACCESS_KEY from environment variable.");
} else {
    console.warn("MY_CUSTOM_ACCESS_KEY environment variable not set. Client authorization will likely fail. Please set it in your Deno Deploy project settings.");
}


export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/v1/chat/completions' && request.method === 'POST') {
        return await handleChatCompletions(request);
      } else if (path === '/v1/images/generations' && request.method === 'POST') {
        return await handleImageGenerations(request);
      } else if (path === '/v1/models' && request.method === 'GET') {
        return await listModels();
      } else {
        return new Response(JSON.stringify({
          error: { message: "Not Found", type: "not_found_error" }
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
    }
  };

  const MODEL_URLS = {
    "FLUX-pro": {
      "submit_url": "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra",
      "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
      "image-to-image": false, "multi-image-input":false,
    },
    "recraft-v3": {
      "submit_url": "https://queue.fal.run/fal-ai/recraft-v3",
      "status_base_url": "https://queue.fal.run/fal-ai/recraft-v3",
      "image-to-image": false, "multi-image-input":false
    },
    "FLUX-1.1-pro": {
      "submit_url": "https://queue.fal.run/fal-ai/flux-pro/v1.1",
      "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
      "image-to-image": false, "multi-image-input":false
    },
    "ideogram": {
      "submit_url": "https://queue.fal.run/fal-ai/ideogram/v2",
      "status_base_url": "https://queue.fal.run/fal-ai/ideogram",
      "image-to-image": false, "multi-image-input":false
    },
    "dall-e-3": {
      "submit_url": "https://queue.fal.run/fal-ai/flux/dev",
      "status_base_url": "https://queue.fal.run/fal-ai/flux",
      "image-to-image": false, "multi-image-input":false
    },
    "google-imagen4": {
      "submit_url": "https://queue.fal.run/fal-ai/imagen4/preview",
      "status_base_url": "https://queue.fal.run/fal-ai/imagen4",
      "image-to-image": false, "multi-image-input":false
    },
    "flux-kontext-edit": {
      "submit_url": "https://queue.fal.run/fal-ai/flux-pro/kontext",
      "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
      "image-to-image": true, "multi-image-input":false
    },
    "flux-kontext-edit-multi": {
      "submit_url": "https://queue.fal.run/fal-ai/flux-pro/kontext/multi",
      "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
      "image-to-image": true, "multi-image-input":true
    },
    "hidream-i1-full": {
      "submit_url": "https://fal.run/fal-ai/hidream-i1-full/stream",
      "status_base_url": "https://queue.fal.run/fal-ai/hidream-i1-full",
      "image-to-image": false, "multi-image-input":false
    },
    "hidream-i1-full-edit": {
      "submit_url": "https://queue.fal.run/fal-ai/hidream-i1-full/image-to-image",
      "status_base_url": "https://queue.fal.run/fal-ai/hidream-i1-full",
      "image-to-image": true, "multi-image-input":false
    },
    "kling-video-v2.1-master": {
      "submit_url": "https://queue.fal.run/fal-ai/kling-video/v2.1/master/image-to-video",
      "status_base_url": "https://queue.fal.run/fal-ai/kling-video",
      "image-to-image": true, "multi-image-input": false, "is_video_model": true
    }
  };

  function getRandomApiKey() {
    if (AI_KEYS.length === 0) {
        console.error("getRandomApiKey: No FAL API keys available from environment variable FAL_API_KEYS.");
        return null;
    }
    const randomIndex = Math.floor(Math.random() * AI_KEYS.length);
    return AI_KEYS[randomIndex];
  }

  function extractAndValidateApiKey(request) {
    const authHeader = request.headers.get('Authorization') || '';
    let userKey;
    if (authHeader.startsWith('Bearer ')) userKey = authHeader.substring(7);
    else if (authHeader.startsWith('Key ')) userKey = authHeader.substring(4);
    else userKey = authHeader;

    if (!CUSTOM_ACCESS_KEY) {
        console.error("extractAndValidateApiKey: MY_CUSTOM_ACCESS_KEY is not set in environment. Cannot validate user key.");
        return { valid: false, userKey, error: "Server authorization misconfiguration." };
    }
    if (userKey !== CUSTOM_ACCESS_KEY) {
        console.warn(`extractAndValidateApiKey: Invalid user key provided: ${userKey ? userKey.substring(0,5)+'...' : 'empty'}`);
        return { valid: false, userKey, error: "Invalid API key." };
    }

    const randomApiKey = getRandomApiKey();
    if (!randomApiKey) {
        return { valid: false, userKey, error: "Server configuration error: No Fal.ai API keys available. Please check the FAL_API_KEYS environment variable on the server." };
    }
    return { valid: true, userKey, apiKey: randomApiKey };
  }

  function parseKlingParamsFromPrompt(promptText) {
    const params = {
        duration: "5",
        aspect_ratio: "16:9",
        negative_prompt: "blur, distort, and low quality",
        cfg_scale: 0.5,
        cleaned_prompt: promptText
    };
    let tempPrompt = ` ${promptText} `;
    const patterns = {
        duration: /(?:\s)(?:duration|dur):\s*("?(5|10)"?)(?=\s)/i,
        aspect_ratio: /(?:\s)(?:aspect_ratio|ar):\s*("?(16:9|9:16|1:1)"?)(?=\s)/i,
        negative_prompt: /(?:\s)(?:negative_prompt|np):\s*("(.*?)"|([^"\s]+(?:\s+[^"\s]+)*))(?=\s(?:duration:|dur:|aspect_ratio:|ar:|cfg_scale:|cfg:|$))/i,
        cfg_scale: /(?:\s)(?:cfg_scale|cfg):\s*(\d*\.?\d+)(?=\s)/i
    };
    let match;
    match = tempPrompt.match(patterns.duration);
    if (match) { params.duration = match[2]; tempPrompt = tempPrompt.replace(match[0], " "); }
    match = tempPrompt.match(patterns.aspect_ratio);
    if (match) { params.aspect_ratio = match[2]; tempPrompt = tempPrompt.replace(match[0], " "); }
    match = tempPrompt.match(patterns.negative_prompt);
    if (match) { params.negative_prompt = (match[2] || match[3]).replace(/"/g, '').trim(); tempPrompt = tempPrompt.replace(match[0], " ");}
    match = tempPrompt.match(patterns.cfg_scale);
    if (match) { const cfgVal = parseFloat(match[1]); if (!isNaN(cfgVal)) { params.cfg_scale = cfgVal; tempPrompt = tempPrompt.replace(match[0], " "); }}
    params.cleaned_prompt = tempPrompt.replace(/\s\s+/g, ' ').trim();
    return params;
  }

  async function handleChatCompletions(request) {
    const authResult = extractAndValidateApiKey(request);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error || "Invalid API key.", type: "authentication_error" } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const { apiKey } = authResult;

    let openaiRequest;
    try { openaiRequest = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: { message: "Invalid JSON in request body.", type: "invalid_request_error" } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const messages = openaiRequest.messages || [];
    const model = openaiRequest.model || 'dall-e-3';
    const stream = openaiRequest.stream === true;

    const modelIdToUse = MODEL_URLS[model] ? model : "dall-e-3";
    const modelConfig = MODEL_URLS[modelIdToUse];
    if (!modelConfig) {
        console.error(`Model configuration for "${modelIdToUse}" not found.`);
         return new Response(JSON.stringify({ error: { message: `Model configuration for "${modelIdToUse}" not found.`, type: "invalid_request_error" } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const isVideoModel = modelConfig.is_video_model || false;

    let prompt = "";
    let imageUrl = null;
    let imageUrls = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'text') prompt = item.text;
            else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
              if (modelConfig["multi-image-input"]) imageUrls.push(item.image_url.url);
              else imageUrl = item.image_url.url;
            }
          }
        } else if (typeof content === 'string') prompt = content;
        break;
      }
    }

    if ((modelConfig["image-to-image"] || isVideoModel) && !imageUrl && imageUrls.length === 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          const assistantContent = messages[i].content;
          if (typeof assistantContent === 'string') {
            const imageMatches = assistantContent.match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/g);
            if (imageMatches && imageMatches.length > 0) {
              const urlMatch = imageMatches[imageMatches.length - 1].match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/);
              if (urlMatch && urlMatch[1]) { imageUrl = urlMatch[1]; break; }
            }
          }
        }
      }
    }
    
    let klingParams = null;
    let actualPromptForFal = prompt;

    if (isVideoModel) {
        if (!imageUrl) {
            return new Response(JSON.stringify({ error: { message: "视频生成需要图片，请上传图片。", type: "invalid_request_error" } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        klingParams = parseKlingParamsFromPrompt(prompt);
        actualPromptForFal = klingParams.cleaned_prompt;
        if (!actualPromptForFal) {
             return new Response(JSON.stringify({ error: { message: "视频生成需要描述性提示词，即使使用了参数，描述部分不能为空。", type: "invalid_request_error" } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    }

    if (!actualPromptForFal && !isVideoModel && !modelConfig["image-to-image"]) {
        return createStreamingDefaultResponse(model, "请描述您想生成的图片。");
    }

    const falRequest = {};
    if (isVideoModel && klingParams) {
        falRequest.prompt = actualPromptForFal;
        falRequest.image_url = imageUrl; // image_url is expected by kling model
        falRequest.duration = klingParams.duration;
        falRequest.aspect_ratio = klingParams.aspect_ratio;
        falRequest.negative_prompt = klingParams.negative_prompt;
        falRequest.cfg_scale = klingParams.cfg_scale;
    } else {
        falRequest.prompt = actualPromptForFal;
        falRequest.num_images = openaiRequest.n || 1;
        if (modelConfig["image-to-image"]) {
            if (modelConfig["multi-image-input"]) {
                if (imageUrls.length > 0) falRequest.image_urls = imageUrls;
                else if (imageUrl) falRequest.image_urls = [imageUrl];
            } else {
                if (imageUrl) falRequest.image_url = imageUrl;
                else if (imageUrls.length > 0) falRequest.image_url = imageUrls[0];
            }
            if (!falRequest.image_url && (!falRequest.image_urls || falRequest.image_urls.length === 0)) {
                 return new Response(JSON.stringify({ error: { message: "此模型需要图片进行编辑/生成，当前消息或历史记录中未找到图片。", type: "invalid_request_error" } }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }
    }

    const falSubmitUrl = modelConfig.submit_url;
    const falStatusBaseUrl = modelConfig.status_base_url;

    try {
      const headers = { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" };
      const falResponse = await fetch(falSubmitUrl, { method: 'POST', headers: headers, body: JSON.stringify(falRequest) });
      
      // MODIFICATION START: Handle 413 Payload Too Large from Fal.ai
      if (falResponse.status === 413) {
          console.error(`Fal API Error (${falSubmitUrl}): 413 - Payload Too Large. Image likely too big.`);
          const errorMsg413 = "错误：上传的图片文件过大，超过了4MB的限制。请尝试使用更小的图片。";
          if (stream) {
              const readableStream = new ReadableStream({
                  start(controller) {
                      const encoder = new TextEncoder();
                      const send = (data) => { try { if (controller.desiredSize !== null) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch(e){ console.warn("Stream controller closed (413 error path):", e.message);}};
                      send({ id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
                      send({ id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: errorMsg413 }, finish_reason: null }] });
                      send({ id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
                      try { if (controller.desiredSize !== null) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); }} catch(e){ console.warn("Stream controller closed (413 error path close):", e.message);};
                  }
              });
              return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
          } else {
              return new Response(JSON.stringify({ error: { message: errorMsg413, type: "invalid_request_error", code: 413 } }),
                                 { status: 413, headers: { 'Content-Type': 'application/json' } });
          }
      }
      // MODIFICATION END: Handle 413 Payload Too Large from Fal.ai

      const responseText = await falResponse.text();
      if (falResponse.status !== 200 && falResponse.status !== 202) {
        console.error(`Fal API Error (${falSubmitUrl}): ${falResponse.status} - ${responseText.substring(0,500)}`);
        return new Response(JSON.stringify({ error: { message: `Fal API 提交错误 (状态 ${falResponse.status}): ${responseText}`, type: "fal_api_error", code: falResponse.status } }),
                           { status: falResponse.status > 0 ? falResponse.status : 500 , headers: { 'Content-Type': 'application/json' } });
      }

      const falData = JSON.parse(responseText);
      const requestId = falData.request_id || (falData.request && falData.request.id);
      if (!requestId) {
        console.error("Fal 响应中没有 request_id:", falData);
        return new Response(JSON.stringify({ error: { message: "Fal API 提交后缺少 request_id。", type: "fal_api_error" } }),
                           { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      
      let generatedArtifactUrls = [];
      const maxAttempts = isVideoModel ? 150 : 45; 
      const pollInterval = isVideoModel ? 4000 : 2500;

      if (stream) {
        const readableStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            let streamClosedByError = false; // Flag to prevent further enqueues if controller is bad

            const send = (data) => {
                if (streamClosedByError) return;
                try {
                    // Check if the stream is still active before trying to enqueue
                    // desiredSize being null means the stream is closing or closed
                    if (controller.desiredSize === null) {
                        console.warn("Stream controller is already closing/closed, cannot enqueue data:", data);
                        streamClosedByError = true; // Prevent further attempts
                        return;
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch (e) {
                    if (e.name === 'TypeError' && (e.message.includes('cannot close or enqueue') || e.message.includes('is closing'))) {
                        console.warn("Stream controller was already closed or in a bad state when trying to enqueue. Client likely disconnected.", e.message);
                        streamClosedByError = true; // Prevent further attempts
                    } else {
                        console.error("Error enqueuing data to stream:", e);
                        streamClosedByError = true; // Prevent further attempts on other errors too
                    }
                }
            };
            
            send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

            let attempt = 0;
            let artifactGenerated = false;
            while (attempt < maxAttempts && !artifactGenerated && !streamClosedByError) {
              try {
                const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
                const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
                
                if (attempt > 0 && attempt % (isVideoModel ? 2 : 4) === 0) {
                     send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? "视频仍在努力处理中..." : "图像仍在努力生成中..." }, finish_reason: null }] });
                }

                const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                
                if (statusRes.status === 200 || statusRes.status === 202) {
                  const statusData = await statusRes.json();

                  if (statusData.status === "FAILED" || (statusData.logs && statusData.logs.some(log => log.level === "ERROR"))) {
                    const errorMsg = statusData.logs?.find(l => l.level === "ERROR")?.message || statusData.error?.message || "Generation failed at Fal API.";
                    send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: `生成失败: ${errorMsg}` }, finish_reason: null }] });
                    artifactGenerated = true; break;
                  }
                  if (statusData.status === "COMPLETED") {
                    const resultRes = await fetch(resultUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                    if (resultRes.status === 200) {
                      const resultData = await resultRes.json();
                      if (isVideoModel) {
                        if (resultData.video && resultData.video.url) generatedArtifactUrls.push(resultData.video.url);
                      } else {
                        if (resultData.images && Array.isArray(resultData.images) && resultData.images.length > 0) resultData.images.forEach(img => img && img.url && generatedArtifactUrls.push(img.url));
                        else if (resultData.image && resultData.image.url) generatedArtifactUrls.push(resultData.image.url);
                      }

                      if (generatedArtifactUrls.length > 0) {
                        artifactGenerated = true;
                        let successMsg = isVideoModel ? `视频生成成功!\n\n` : (modelConfig["image-to-image"] ? `图像编辑成功!\n\n` : `图像生成成功!\n\n`);
                        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: successMsg }, finish_reason: null }] });
                        generatedArtifactUrls.forEach((url, i) => {
                          if (i > 0) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: "\n\n" }, finish_reason: null }] });
                          send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? `视频链接: ${url}` : `![Generated ${i+1}](${url})` }, finish_reason: null }] });
                        });
                      } else { 
                        artifactGenerated = true; 
                        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: "生成任务已完成，但未能从Fal API获取有效的输出URL。" }, finish_reason: null }] }); 
                      }
                    } else { 
                        console.error(`Stream: Fal result fetch error: ${resultRes.status} ${await resultRes.text()}`); 
                        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: `获取结果失败 (HTTP ${resultRes.status})。` }, finish_reason: null }] });
                        artifactGenerated = true;
                    }
                  }
                } else {
                  const errorText = await statusRes.text();
                  console.error(`Stream: Fal status check serious error: ${statusRes.status} - ${errorText}`);
                  send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: `检查任务状态时出错 (HTTP ${statusRes.status}): ${errorText.substring(0,100)}` }, finish_reason: null }] });
                  artifactGenerated = true;
                }
              } catch (e) { 
                  console.error(`Stream: Polling exception: ${e.toString()}`); 
                  send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: `轮询过程中发生错误: ${e.toString().substring(0,100)}` }, finish_reason: null }] });
                  artifactGenerated = true;
              }
              if (!artifactGenerated && !streamClosedByError) { await new Promise(r => setTimeout(r, pollInterval)); attempt++; }
            }

            if (!artifactGenerated && !streamClosedByError) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? "视频生成超时，请稍后再试或调整参数。" : "图像生成超时，请稍后再试或调整参数。" }, finish_reason: null }] });
            
            if (!streamClosedByError) {
                send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
                try {
                    if (controller.desiredSize !== null) {
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
                    }
                } catch (e) {
                    if (e.name === 'TypeError' && (e.message.includes('cannot close or enqueue') || e.message.includes('is closing'))) {
                         console.warn("Stream controller was already closed when trying to send [DONE] or close.", e.message);
                    } else {
                         console.error("Error sending [DONE] or closing stream:", e);
                    }
                }
            }
          }
        });
        return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      }

      // Non-streaming polling
      let attempt = 0;
      let artifactGeneratedNonStream = false;
      while (attempt < maxAttempts && !artifactGeneratedNonStream) {
        await new Promise(r => setTimeout(r, pollInterval)); 
        attempt++;
         try {
            const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
            const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
            const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });

            if (statusRes.status === 200 || statusRes.status === 202) {
                const statusData = await statusRes.json();
                 if (statusData.status === "FAILED" || (statusData.logs && statusData.logs.some(log => log.level === "ERROR"))) {
                    const errorMsg = statusData.logs?.find(l => l.level === "ERROR")?.message || statusData.error?.message || "Generation failed at Fal API.";
                    return new Response(JSON.stringify({ error: { message: errorMsg, type: "generation_failed" } }),
                                       { status: 500, headers: { 'Content-Type': 'application/json' } });
                }
                if (statusData.status === "COMPLETED") {
                    const resultRes = await fetch(resultUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                    if (resultRes.status === 200) {
                        const resultData = await resultRes.json();
                         if (isVideoModel) {
                            if (resultData.video && resultData.video.url) generatedArtifactUrls.push(resultData.video.url);
                        } else {
                            if (resultData.images && Array.isArray(resultData.images) && resultData.images.length > 0) resultData.images.forEach(img => img && img.url && generatedArtifactUrls.push(img.url));
                            else if (resultData.image && resultData.image.url) generatedArtifactUrls.push(resultData.image.url);
                        }
                        if (generatedArtifactUrls.length > 0) {
                            artifactGeneratedNonStream = true; 
                        } else {
                             return new Response(JSON.stringify({ error: { message: "生成任务已完成，但未能从Fal API获取有效的输出URL。", type: "generation_failed" } }),
                                       { status: 500, headers: { 'Content-Type': 'application/json' } });
                        }
                    } else {
                        const errorText = await resultRes.text();
                        console.error(`Non-Stream: Fal result fetch error: ${resultRes.status} - ${errorText}`);
                        return new Response(JSON.stringify({ error: { message: `获取结果失败 (HTTP ${resultRes.status}): ${errorText.substring(0,200)}`, type: "generation_failed" } }),
                                       { status: 500, headers: { 'Content-Type': 'application/json' } });
                    }
                }
            } else {
                const errorText = await statusRes.text();
                console.error(`Non-Stream: Fal status check serious error: ${statusRes.status} - ${errorText}`);
                return new Response(JSON.stringify({ error: { message: `检查任务状态时出错 (HTTP ${statusRes.status}): ${errorText.substring(0,200)}`, type: "generation_failed" } }),
                                       { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
        } catch (e) { 
            console.error(`Non-stream polling exception: ${e.toString()}`);
            return new Response(JSON.stringify({ error: { message: `轮询过程中发生错误: ${e.toString()}`, type: "server_error" } }),
                                       { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (generatedArtifactUrls.length === 0) {
        return new Response(JSON.stringify({ id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model: modelIdToUse,
          choices: [{ index: 0, message: { role: "assistant", content: isVideoModel ? "无法生成视频或超时，请重试。" : "无法生成图像或超时，请重试。" }, finish_reason: "stop" }],
          usage: { prompt_tokens: Math.floor(prompt.length/4), completion_tokens: 20, total_tokens: Math.floor(prompt.length/4) + 20 }
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      let content = isVideoModel ? `视频生成成功!\n\n` : (modelConfig["image-to-image"] ? `图像编辑成功!\n\n` : `图像生成成功!\n\n`);
      generatedArtifactUrls.forEach((url, i) => {
        if (i > 0) content += "\n\n";
        content += isVideoModel ? `视频链接: ${url}` : `![Generated ${i+1}](${url})`;
      });
      
      return new Response(JSON.stringify({ id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model: modelIdToUse,
        choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.floor(prompt.length/4), completion_tokens: Math.floor(content.length/4), total_tokens: Math.floor(prompt.length/4) + Math.floor(content.length/4) }
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (e) {
      console.error(`Overall exception in handleChatCompletions: ${e.toString()}`, e.stack);
      return new Response(JSON.stringify({ error: { message: `服务器错误: ${e.toString()}`, type: "server_error" } }),
                         { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  function createStreamingDefaultResponse(model, message) {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data) => { try { if (controller.desiredSize !== null) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch(e){ console.warn("Stream controller closed (default response):", e.message);}};
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: message }, finish_reason: null }] });
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        try { if (controller.desiredSize !== null) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); }} catch(e){ console.warn("Stream controller closed (default response close):", e.message);};
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
  }

  async function handleImageGenerations(request) {
    const authResult = extractAndValidateApiKey(request);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error || "Invalid API key.", type: "authentication_error" } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let openaiRequest;
    try { openaiRequest = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: { message: "图像生成请求体JSON无效", type: "invalid_request_error" } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const prompt = openaiRequest.prompt || '';
    const model = openaiRequest.model || 'dall-e-3';
    const stream = openaiRequest.stream === true;
    const imageUrl = openaiRequest.image_url || null; 

    const messages = [];
    let userContent = [];
    if (prompt) userContent.push({ type: "text", text: prompt });
    if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });
    
    if (userContent.length === 0) {
         return new Response(JSON.stringify({ error: { message: "图像生成需要Prompt或image_url。", type: "invalid_request_error" } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    messages.push({ role: "user", content: userContent });

    const chatPayload = { model, messages, stream, n: openaiRequest.n }; 
    
    const clonedHeaders = new Headers(request.headers);
    if (!clonedHeaders.has('Authorization')) {
        clonedHeaders.set('Authorization', `Key ${authResult.userKey}`);
    }
    
    const chatRequestUrl = new URL(request.url);
    chatRequestUrl.pathname = '/v1/chat/completions';

    const chatRequest = new Request(chatRequestUrl.toString(), {
        method: 'POST', headers: clonedHeaders, body: JSON.stringify(chatPayload)
    });
    return handleChatCompletions(chatRequest);
  }

  async function listModels() {
    const modelsData = Object.keys(MODEL_URLS).map(id => ({
        id: id, object: "model", created: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3600 * 24 * 7), 
        owned_by: "fal-openai-adapter",
        permission: [], 
        root: id.split('-')[0],
        parent: null
    }));
    return new Response(JSON.stringify({ object: "list", data: modelsData }),
      { headers: { 'Content-Type': 'application/json' } });
  }