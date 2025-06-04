export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/v1/chat/completions' && request.method === 'POST') {
        return await handleChatCompletions(request, env);
      } else if (path === '/v1/images/generations' && request.method === 'POST') {
        return await handleImageGenerations(request, env);
      } else if (path === '/v1/models' && request.method === 'GET') {
        return await listModels();
      } else {
        return new Response(JSON.stringify({
          error: { message: "Not Found", type: "not_found_error" }
        }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
    }
  };

  const AI_KEYS = [
    "xxx-xxx-xxx", // 请替换成您的 FAL_KEY
    // "yyy-yyy-yyy"  // 可以添加更多 FAL_KEY
  ];
  const CUSTOM_ACCESS_KEY = "123321"; // 请替换成您自定义的 OPENAI_API_KEY

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
    if (AI_KEYS.length === 0 || (AI_KEYS.length === 1 && AI_KEYS[0] === "xxx-xxx-xxx")) {
        console.error("AI_KEYS array is empty or not configured. Please provide FAL API keys.");
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

    if (userKey !== CUSTOM_ACCESS_KEY) return { valid: false, userKey };

    const randomApiKey = getRandomApiKey();
    if (!randomApiKey) return { valid: false, userKey, error: "No Fal.ai API keys available in server configuration." };
    // console.log(`Selected random API key: ${randomApiKey.substring(0, 3)}...`);
    return { valid: true, userKey, apiKey: randomApiKey };
  }

  function parseKlingParamsFromPrompt(promptText) {
    const params = {
        duration: "5", // Default from fal.ai docs for kling-video-v2.1-master
        aspect_ratio: "16:9", // Default
        negative_prompt: "blur, distort, and low quality", // Default
        cfg_scale: 0.5, // Default
        cleaned_prompt: promptText
    };
    let tempPrompt = ` ${promptText} `; // Add spaces for easier regex matching at boundaries

    const patterns = {
        duration: /(?:\s)(?:duration|dur):\s*("?(5|10)"?)(?=\s)/i,
        aspect_ratio: /(?:\s)(?:aspect_ratio|ar):\s*("?(16:9|9:16|1:1)"?)(?=\s)/i,
        negative_prompt: /(?:\s)(?:negative_prompt|np):\s*("(.*?)"|([^"\s]+(?:\s+[^"\s]+)*))(?=\s(?:duration:|dur:|aspect_ratio:|ar:|cfg_scale:|cfg:|$))/i,
        cfg_scale: /(?:\s)(?:cfg_scale|cfg):\s*(\d*\.?\d+)(?=\s)/i
    };

    let match;

    match = tempPrompt.match(patterns.duration);
    if (match) {
        params.duration = match[2];
        tempPrompt = tempPrompt.replace(match[0], " ");
    }

    match = tempPrompt.match(patterns.aspect_ratio);
    if (match) {
        params.aspect_ratio = match[2];
        tempPrompt = tempPrompt.replace(match[0], " ");
    }
    
    match = tempPrompt.match(patterns.negative_prompt);
    if (match) {
        params.negative_prompt = (match[2] || match[3]).replace(/"/g, '').trim();
        tempPrompt = tempPrompt.replace(match[0], " ");
    }

    match = tempPrompt.match(patterns.cfg_scale);
    if (match) {
        const cfgVal = parseFloat(match[1]);
        if (!isNaN(cfgVal)) {
            params.cfg_scale = cfgVal;
            tempPrompt = tempPrompt.replace(match[0], " ");
        }
    }
    
    params.cleaned_prompt = tempPrompt.replace(/\s\s+/g, ' ').trim();
    return params;
  }

  async function handleChatCompletions(request, env) {
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
    console.log(`Model: ${model}, Stream: ${stream}`);

    const modelConfig = MODEL_URLS[model] || MODEL_URLS["dall-e-3"];
    const isVideoModel = modelConfig.is_video_model || false;

    let prompt = "";
    let imageUrl = null;
    let imageUrls = []; // For multi-image models (not kling)

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
      // Attempt to find last AI generated image if no image in current user message
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          const assistantContent = messages[i].content;
          if (typeof assistantContent === 'string') {
            const imageMatches = assistantContent.match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/g);
            if (imageMatches && imageMatches.length > 0) {
              const urlMatch = imageMatches[imageMatches.length - 1].match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/);
              if (urlMatch && urlMatch[1]) {
                imageUrl = urlMatch[1];
                console.log(`Using image from chat history: ${imageUrl.substring(0,50)}...`);
                break;
              }
            }
          }
        }
      }
    }
    
    let klingParams = null;
    let actualPromptForFal = prompt;

    if (isVideoModel) {
        if (!imageUrl) {
            return new Response(JSON.stringify({ error: { message: "Video generation with this model requires an image. Please upload an image.", type: "invalid_request_error" } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        klingParams = parseKlingParamsFromPrompt(prompt);
        actualPromptForFal = klingParams.cleaned_prompt;
        console.log("Kling Params Parsed:", klingParams);
        if (!actualPromptForFal) {
             return new Response(JSON.stringify({ error: { message: "Video generation requires a descriptive prompt, even with parameters. The descriptive part of your prompt is empty.", type: "invalid_request_error" } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    }

    if (!actualPromptForFal && !isVideoModel && !modelConfig["image-to-image"]) { // Text-to-image model with empty prompt
        return createStreamingDefaultResponse(model, "Please describe the image you want to generate.");
    }
    console.log(`Effective prompt for Fal API: ${actualPromptForFal}`);

    const falRequest = {};
    if (isVideoModel && klingParams) {
        falRequest.prompt = actualPromptForFal;
        falRequest.image_url = imageUrl;
        falRequest.duration = klingParams.duration;
        falRequest.aspect_ratio = klingParams.aspect_ratio;
        falRequest.negative_prompt = klingParams.negative_prompt;
        falRequest.cfg_scale = klingParams.cfg_scale;
    } else { // Image models
        falRequest.prompt = actualPromptForFal; // Can be empty for image-to-image
        falRequest.num_images = openaiRequest.n || 1;
        if (modelConfig["image-to-image"]) { // Includes standard image-to-image
            if (modelConfig["multi-image-input"]) {
                if (imageUrls.length > 0) falRequest.image_urls = imageUrls;
                else if (imageUrl) falRequest.image_urls = [imageUrl]; // Send as array even if one
            } else {
                if (imageUrl) falRequest.image_url = imageUrl;
                else if (imageUrls.length > 0) falRequest.image_url = imageUrls[0]; // Use first if multi not supported
            }
            if (!falRequest.image_url && (!falRequest.image_urls || falRequest.image_urls.length === 0)) {
                 // If it's an edit model but no image is found (neither current nor history)
                 return new Response(JSON.stringify({ error: { message: "This model requires an image for editing/generation. None found.", type: "invalid_request_error" } }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }
    }

    console.log("Making request to Fal API:", JSON.stringify(falRequest));
    const falSubmitUrl = modelConfig.submit_url;
    const falStatusBaseUrl = modelConfig.status_base_url;

    try {
      const headers = { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" };
      const falResponse = await fetch(falSubmitUrl, { method: 'POST', headers: headers, body: JSON.stringify(falRequest) });
      
      const responseText = await falResponse.text();
      if (falResponse.status !== 200 && falResponse.status !== 202) { // Fal can return 202 for queued
        console.error(`Fal API Error (${falSubmitUrl}): ${falResponse.status} - ${responseText}`);
        return new Response(JSON.stringify({ error: { message: `Fal API submission error: ${responseText}`, type: "fal_api_error", code: falResponse.status } }),
                           { status: falResponse.status, headers: { 'Content-Type': 'application/json' } });
      }

      const falData = JSON.parse(responseText);
      const requestId = falData.request_id || (falData.request && falData.request.id);
      if (!requestId) {
        console.error("No request_id in Fal response:", falData);
        return new Response(JSON.stringify({ error: { message: "Missing request_id from Fal API.", type: "fal_api_error" } }),
                           { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      console.log(`Got request_id: ${requestId}`);
      
      let generatedArtifactUrls = [];
      const maxAttempts = isVideoModel ? 60 : 40; // Longer for video
      const pollInterval = isVideoModel ? 3000 : 2000;

      if (stream) {
        const readableStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

            let attempt = 0;
            let artifactGenerated = false;
            while (attempt < maxAttempts && !artifactGenerated) {
              try {
                const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
                const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
                
                if (attempt > 0 && attempt % (isVideoModel ? 3 : 5) === 0) { // Progress update
                     send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: isVideoModel ? "视频仍在处理中..." : "图像仍在生成中..." }, finish_reason: null }] });
                }

                const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                if (statusRes.status === 200) {
                  const statusData = await statusRes.json();
                  console.log(`Poll ${attempt+1}: status ${statusData.status}, progress ${statusData.progress || 'N/A'}`);
                  if (statusData.status === "FAILED" || (statusData.logs && statusData.logs.some(log => log.level === "ERROR"))) {
                    const errorMsg = statusData.logs?.find(l => l.level === "ERROR")?.message || "Generation failed at Fal API.";
                    send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index:0, delta:{ content: `生成失败: ${errorMsg}` }, finish_reason: null }] });
                    artifactGenerated = true; break;
                  }
                  if (statusData.status === "COMPLETED") {
                    const resultRes = await fetch(resultUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                    if (resultRes.status === 200) {
                      const resultData = await resultRes.json();
                      if (isVideoModel) {
                        if (resultData.video && resultData.video.url) generatedArtifactUrls.push(resultData.video.url);
                      } else {
                        if (resultData.images && resultData.images.length > 0) resultData.images.forEach(img => img.url && generatedArtifactUrls.push(img.url));
                        else if (resultData.image && resultData.image.url) generatedArtifactUrls.push(resultData.image.url);
                      }

                      if (generatedArtifactUrls.length > 0) {
                        artifactGenerated = true;
                        let successMsg = isVideoModel ? `视频生成成功!\n\n` : (modelConfig["image-to-image"] ? `图像编辑成功!\n\n` : `图像生成成功!\n\n`);
                        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: successMsg }, finish_reason: null }] });
                        generatedArtifactUrls.forEach((url, i) => {
                          if (i > 0) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: "\n\n" }, finish_reason: null }] });
                          send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: isVideoModel ? `视频链接: ${url}` : `![Generated ${i+1}](${url})` }, finish_reason: null }] });
                        });
                      } else { artifactGenerated = true; send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index:0, delta:{ content: "生成完成，但未找到有效的输出URL。" }, finish_reason: null }] }); }
                    } else { console.error(`Fal result fetch error: ${resultRes.status} ${await resultRes.text()}`); }
                  }
                } else { console.warn(`Fal status check error: ${statusRes.status} ${await statusRes.text()}`); }
              } catch (e) { console.error(`Polling exception: ${e}`); }
              if (!artifactGenerated) { await new Promise(r => setTimeout(r, pollInterval)); attempt++; }
            }
            if (!artifactGenerated) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: isVideoModel ? "视频生成超时。" : "图像生成超时。" }, finish_reason: null }] });
            send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        });
        return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      }

      // Non-streaming polling
      let attempt = 0;
      while (attempt < maxAttempts) {
        // ... (Non-streaming polling logic similar to streaming, but constructs a single final response)
        // This part is kept brief as streaming is often preferred. The logic would mirror the streaming poll.
        await new Promise(r => setTimeout(r, pollInterval)); attempt++;
        // Simplified for brevity: assume it populates generatedArtifactUrls or fails.
        // In a full implementation, this loop would be similar to the stream's polling loop.
         try {
            const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
            const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
            const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
            if (statusRes.status === 200) {
                const statusData = await statusRes.json();
                if (statusData.status === "FAILED") {
                    const errorMsg = statusData.logs?.find(l => l.level === "ERROR")?.message || "Generation failed at Fal API.";
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
                            if (resultData.images && resultData.images.length > 0) resultData.images.forEach(img => img.url && generatedArtifactUrls.push(img.url));
                            else if (resultData.image && resultData.image.url) generatedArtifactUrls.push(resultData.image.url);
                        }
                        if (generatedArtifactUrls.length > 0) break; // Found results
                    }
                }
            }
        } catch (e) { console.error(`Non-stream polling exception: ${e}`); }
      }


      if (generatedArtifactUrls.length === 0) {
        return new Response(JSON.stringify({ id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model,
          choices: [{ index: 0, message: { role: "assistant", content: isVideoModel ? "无法生成视频，请重试。" : "无法生成图像，请重试。" }, finish_reason: "stop" }],
          usage: { prompt_tokens: Math.floor(prompt.length/4), completion_tokens: 20, total_tokens: Math.floor(prompt.length/4) + 20 }
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      let content = isVideoModel ? `视频生成成功!\n\n` : (modelConfig["image-to-image"] ? `图像编辑成功!\n\n` : `图像生成成功!\n\n`);
      generatedArtifactUrls.forEach((url, i) => {
        if (i > 0) content += "\n\n";
        content += isVideoModel ? `视频链接: ${url}` : `![Generated ${i+1}](${url})`;
      });
      
      return new Response(JSON.stringify({ id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model,
        choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.floor(prompt.length/4), completion_tokens: Math.floor(content.length/4), total_tokens: Math.floor(prompt.length/4) + Math.floor(content.length/4) }
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (e) {
      console.error(`Overall exception: ${e}`, e.stack);
      return new Response(JSON.stringify({ error: { message: `Server error: ${e.toString()}`, type: "server_error" } }),
                         { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  function createStreamingDefaultResponse(model, message) {
    const requestId = Date.now().toString(36);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: message }, finish_reason: null }] });
        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
  }

  async function handleImageGenerations(request, env) {
    const authResult = extractAndValidateApiKey(request);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error || "Invalid API key.", type: "authentication_error" } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let openaiRequest;
    try { openaiRequest = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: { message: "Invalid JSON in request body", type: "invalid_request_error" } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const prompt = openaiRequest.prompt || '';
    const model = openaiRequest.model || 'dall-e-3';
    const stream = openaiRequest.stream === true;
    const imageUrl = openaiRequest.image_url || null; // Fal-specific for image-to-image in this endpoint

    const messages = [];
    let userContent = [{ type: "text", text: prompt }];
    if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });
    messages.push({ role: "user", content: userContent });

    const chatPayload = { model, messages, stream, n: openaiRequest.n }; // Pass 'n' if present
    
    const clonedHeaders = new Headers(request.headers);
    if (!clonedHeaders.has('Authorization')) clonedHeaders.set('Authorization', `Key ${authResult.userKey}`);

    const chatRequest = new Request(new URL(request.url).origin + '/v1/chat/completions', {
        method: 'POST', headers: clonedHeaders, body: JSON.stringify(chatPayload)
    });
    return handleChatCompletions(chatRequest, env);
  }

  async function listModels() {
    const modelsData = Object.keys(MODEL_URLS).map(id => ({
        id: id, object: "model", created: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3600 * 24 * 30), // random creation time
        owned_by: "fal-openai-adapter", permission: [], root: id.split('-')[0], parent: null
    }));
    return new Response(JSON.stringify({ object: "list", data: modelsData }),
      { headers: { 'Content-Type': 'application/json' } });
  }