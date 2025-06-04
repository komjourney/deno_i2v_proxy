// Read FAL_API_KEYS (comma-separated) from environment variable
// v1
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

// Read CUSTOM_ACCESS_KEY from environment variable
const customAccessKeyEnv = Deno.env.get("MY_CUSTOM_ACCESS_KEY");
let CUSTOM_ACCESS_KEY = "";
if (customAccessKeyEnv) {
    CUSTOM_ACCESS_KEY = customAccessKeyEnv;
    console.log("Successfully loaded MY_CUSTOM_ACCESS_KEY from environment variable.");
} else {
    console.warn("MY_CUSTOM_ACCESS_KEY environment variable not set. Client authorization will likely fail. Please set it in your Deno Deploy project settings.");
}


export default {
    async fetch(request, env) { // env is part of Cloudflare Workers signature, not directly used here but common pattern
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

  // MODEL_URLS remains the same as your previous version
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
    "dall-e-3": { // This seems to be a placeholder or an alias in your original config
      "submit_url": "https://queue.fal.run/fal-ai/flux/dev", // Example, ensure this is correct if used
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
    // console.log(`Selected random Fal API key: ${randomApiKey.substring(0, 3)}...`);
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
    const model = openaiRequest.model || 'dall-e-3'; // Default model if not specified
    const stream = openaiRequest.stream === true;
    // console.log(`ChatCompletions: Model: ${model}, Stream: ${stream}`);

    const modelIdToUse = MODEL_URLS[model] ? model : "dall-e-3"; // Fallback to a default if model key doesn't exist
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
              if (urlMatch && urlMatch[1]) { imageUrl = urlMatch[1]; /* console.log(`Using image from history: ${imageUrl.substring(0,50)}...`); */ break; }
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
        // console.log("Kling Params Parsed:", klingParams);
        if (!actualPromptForFal) {
             return new Response(JSON.stringify({ error: { message: "Video generation requires a descriptive prompt for the video content, even when using parameters. The descriptive part of your prompt is empty.", type: "invalid_request_error" } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    }

    if (!actualPromptForFal && !isVideoModel && !modelConfig["image-to-image"]) {
        return createStreamingDefaultResponse(model, "Please describe the image you want to generate.");
    }
    // console.log(`Effective prompt for Fal API: ${actualPromptForFal}`);

    const falRequest = {};
    if (isVideoModel && klingParams) {
        falRequest.prompt = actualPromptForFal;
        falRequest.image_url = imageUrl;
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
                 return new Response(JSON.stringify({ error: { message: "This model requires an image for editing/generation. None found in current message or history.", type: "invalid_request_error" } }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }
    }

    // console.log("Making request to Fal API:", JSON.stringify(falRequest));
    const falSubmitUrl = modelConfig.submit_url;
    const falStatusBaseUrl = modelConfig.status_base_url;

    try {
      const headers = { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" };
      const falResponse = await fetch(falSubmitUrl, { method: 'POST', headers: headers, body: JSON.stringify(falRequest) });
      
      const responseText = await falResponse.text();
      // Fal can return 202 for queued requests which is also a success for submission
      if (falResponse.status !== 200 && falResponse.status !== 202) {
        console.error(`Fal API Error (${falSubmitUrl}): ${falResponse.status} - ${responseText.substring(0,500)}`);
        return new Response(JSON.stringify({ error: { message: `Fal API submission error (status ${falResponse.status}): ${responseText}`, type: "fal_api_error", code: falResponse.status } }),
                           { status: falResponse.status > 0 ? falResponse.status : 500 , headers: { 'Content-Type': 'application/json' } });
      }

      const falData = JSON.parse(responseText);
      // Fal might return request_id directly, or nested under a "request" object for some endpoints
      const requestId = falData.request_id || (falData.request && falData.request.id);
      if (!requestId) {
        console.error("No request_id in Fal response:", falData);
        return new Response(JSON.stringify({ error: { message: "Missing request_id from Fal API after submission.", type: "fal_api_error" } }),
                           { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      // console.log(`Got request_id: ${requestId}`);
      
      let generatedArtifactUrls = [];
      const maxAttempts = isVideoModel ? 70 : 45; // Increased attempts for video
      const pollInterval = isVideoModel ? 4000 : 2500; // Increased interval for video

      if (stream) {
        const readableStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

            let attempt = 0;
            let artifactGenerated = false;
            while (attempt < maxAttempts && !artifactGenerated) {
              try {
                const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
                const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
                
                if (attempt > 0 && attempt % (isVideoModel ? 2 : 4) === 0) { // Progress update more frequently for video
                     send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? "视频仍在努力处理中..." : "图像仍在努力生成中..." }, finish_reason: null }] });
                }

                const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
                if (statusRes.status === 200) {
                  const statusData = await statusRes.json();
                  // console.log(`Poll ${attempt+1}: status ${statusData.status}, progress ${statusData.progress || 'N/A'}`);
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
                      } else { // Image models
                        if (resultData.images && Array.isArray(resultData.images) && resultData.images.length > 0) resultData.images.forEach(img => img && img.url && generatedArtifactUrls.push(img.url));
                        else if (resultData.image && resultData.image.url) generatedArtifactUrls.push(resultData.image.url); // some models might return a single image object
                      }

                      if (generatedArtifactUrls.length > 0) {
                        artifactGenerated = true;
                        let successMsg = isVideoModel ? `视频生成成功!\n\n` : (modelConfig["image-to-image"] ? `图像编辑成功!\n\n` : `图像生成成功!\n\n`);
                        send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: successMsg }, finish_reason: null }] });
                        generatedArtifactUrls.forEach((url, i) => {
                          if (i > 0) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: "\n\n" }, finish_reason: null }] });
                          send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? `视频链接: ${url}` : `![Generated ${i+1}](${url})` }, finish_reason: null }] });
                        });
                      } else { artifactGenerated = true; send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created:Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index:0, delta:{ content: "生成任务已完成，但未能从Fal API获取有效的输出URL。" }, finish_reason: null }] }); }
                    } else { console.error(`Fal result fetch error: ${resultRes.status} ${await resultRes.text()}`); /* Potentially send error chunk */ }
                  }
                } else { console.warn(`Fal status check error: ${statusRes.status} ${await statusRes.text()}`); /* Potentially send error chunk */ }
              } catch (e) { console.error(`Polling exception: ${e.toString()}`); /* Potentially send error chunk */ }
              if (!artifactGenerated) { await new Promise(r => setTimeout(r, pollInterval)); attempt++; }
            }
            if (!artifactGenerated) send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: { content: isVideoModel ? "视频生成超时，请稍后再试或调整参数。" : "图像生成超时，请稍后再试或调整参数。" }, finish_reason: null }] });
            send({ id: `chatcmpl-${requestId}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: modelIdToUse, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        });
        return new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      }

      // Non-streaming polling
      let attempt = 0;
      while (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, pollInterval)); 
        attempt++;
         try {
            const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`;
            const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
            const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
            if (statusRes.status === 200) {
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
                        if (generatedArtifactUrls.length > 0) break; 
                    }
                }
            }
        } catch (e) { console.error(`Non-stream polling exception: ${e.toString()}`); }
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
      return new Response(JSON.stringify({ error: { message: `Server error: ${e.toString()}`, type: "server_error" } }),
                         { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  function createStreamingDefaultResponse(model, message) {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
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

  async function handleImageGenerations(request) {
    const authResult = extractAndValidateApiKey(request);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error || "Invalid API key.", type: "authentication_error" } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let openaiRequest;
    try { openaiRequest = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: { message: "Invalid JSON in request body for image generation", type: "invalid_request_error" } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const prompt = openaiRequest.prompt || '';
    const model = openaiRequest.model || 'dall-e-3'; // Default if not specified
    const stream = openaiRequest.stream === true;
    // For /v1/images/generations, Fal's image-to-image might expect image_url directly in the payload if this route is kept Fal-specific.
    // However, to unify, we'll convert it to the chat completions format.
    const imageUrl = openaiRequest.image_url || null; 

    const messages = [];
    let userContent = [];
    if (prompt) userContent.push({ type: "text", text: prompt });
    if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });
    
    if (userContent.length === 0) {
         return new Response(JSON.stringify({ error: { message: "Prompt or image_url is required for image generation.", type: "invalid_request_error" } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    messages.push({ role: "user", content: userContent });

    const chatPayload = { model, messages, stream, n: openaiRequest.n }; 
    
    const clonedHeaders = new Headers(request.headers);
    // Ensure Authorization is passed correctly; extractAndValidateApiKey already did its job for this request.
    // For the sub-request to handleChatCompletions, it will re-validate using the same CUSTOM_ACCESS_KEY.
    if (!clonedHeaders.has('Authorization')) {
        // This is important: the sub-request to handleChatCompletions needs the original user's key
        clonedHeaders.set('Authorization', `Key ${authResult.userKey}`);
    }
    
    // Construct a new Request object to call handleChatCompletions internally
    const chatRequestUrl = new URL(request.url);
    chatRequestUrl.pathname = '/v1/chat/completions'; // Change path to the chat completions endpoint

    const chatRequest = new Request(chatRequestUrl.toString(), {
        method: 'POST', headers: clonedHeaders, body: JSON.stringify(chatPayload)
    });
    return handleChatCompletions(chatRequest); // Call the chat completions handler
  }

  async function listModels() {
    const modelsData = Object.keys(MODEL_URLS).map(id => ({
        id: id, object: "model", created: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3600 * 24 * 7), 
        owned_by: "fal-openai-adapter", // Or your specific identifier
        permission: [], 
        root: id.split('-')[0], // Basic root model name
        parent: null
    }));
    return new Response(JSON.stringify({ object: "list", data: modelsData }),
      { headers: { 'Content-Type': 'application/json' } });
  }