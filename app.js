const storageKey = "youtube-memory-tool:v1";
const keyStorageKey = "youtube-memory-tool:gemini-key";
const categoryStorageKey = "youtube-memory-tool:categories:v1";
const baseCategories = [
  "Tech",
  "Sports",
  "Business",
  "Education",
  "Science",
  "Culture",
  "Health",
  "History",
  "Philosophy",
  "Entertainment",
  "News",
  "Other",
];

const defaultPrompt = `Analyze this YouTube video for long-term memory.

Return ONLY valid JSON with this shape:
{
  "title": "Clear English video title",
  "titleHe": "כותרת ברורה בעברית",
  "oneSentence": "The core idea in one English sentence.",
  "oneSentenceHe": "הרעיון המרכזי במשפט אחד בעברית.",
  "overview": "English summary based on the requested length.",
  "overviewHe": "סיכום בעברית לפי האורך שהתבקש.",
  "category": "One English category, such as Tech, Sports, Business, Education, Science, Culture, Health, History, Philosophy, Entertainment, News, Other",
  "sections": [
    {
      "title": "English section title",
      "titleHe": "כותרת המקטע בעברית",
      "timestamp": "MM:SS or HH:MM:SS if known",
      "summary": "What happens in this section in English.",
      "summaryHe": "מה קורה במקטע הזה בעברית.",
      "keyPoints": ["Specific English takeaway", "Specific English takeaway"],
      "keyPointsHe": ["תובנה ספציפית בעברית", "תובנה ספציפית בעברית"]
    }
  ],
  "importantIdeas": ["Idea worth remembering in English"],
  "importantIdeasHe": ["רעיון שחשוב לזכור בעברית"],
  "actionItems": ["Practical action in English, or an empty array if none"],
  "actionItemsHe": ["פעולה מעשית בעברית, או מערך ריק אם אין"],
  "keywords": ["english", "searchable", "terms"],
  "tags": ["short", "english", "tags"],
  "tagsHe": ["תגיות", "קצרות", "בעברית"]
}

Keep the main memory in English, but always provide complete Hebrew access fields for title, one-sentence summary, full summary, every section title, every section summary, every section bullet, important ideas, action items, and tags. Use timestamps when they can be inferred. Prefer concrete claims, names, examples, and definitions over generic praise.`;

const els = {
  form: document.querySelector("#summaryForm"),
  apiKey: document.querySelector("#apiKey"),
  youtubeUrl: document.querySelector("#youtubeUrl"),
  modelName: document.querySelector("#modelName"),
  summaryLength: document.querySelector("#summaryLength"),
  category: document.querySelector("#category"),
  tags: document.querySelector("#tags"),
  prompt: document.querySelector("#prompt"),
  summarizeBtn: document.querySelector("#summarizeBtn"),
  saveKeyBtn: document.querySelector("#saveKeyBtn"),
  clearFormBtn: document.querySelector("#clearFormBtn"),
  status: document.querySelector("#status"),
  searchInput: document.querySelector("#searchInput"),
  categoryNav: document.querySelector("#categoryNav"),
  newCategoryBtn: document.querySelector("#newCategoryBtn"),
  renameCategoryBtn: document.querySelector("#renameCategoryBtn"),
  deleteCategoryBtn: document.querySelector("#deleteCategoryBtn"),
  memoryList: document.querySelector("#memoryList"),
  memoryDetail: document.querySelector("#memoryDetail"),
  memoryCount: document.querySelector("#memoryCount"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
};

let memories = loadMemories();
let selectedId = memories[0]?.id ?? null;
let activeCategory = "All";
let serverSyncAvailable = false;
let serverGeminiKeyAvailable = false;
let customCategories = loadCustomCategories();

els.prompt.value = defaultPrompt;
els.apiKey.value = localStorage.getItem(keyStorageKey) ?? "";

render();
initRemoteSync();

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await summarizeAndSave();
});

els.saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem(keyStorageKey, els.apiKey.value.trim());
  setStatus("Gemini key saved in this browser.");
});

els.clearFormBtn.addEventListener("click", () => {
  els.youtubeUrl.value = "";
  els.category.value = "auto";
  els.tags.value = "";
  els.prompt.value = defaultPrompt;
  setStatus("");
});

els.searchInput.addEventListener("input", render);
els.newCategoryBtn?.addEventListener("click", addCategory);
els.renameCategoryBtn?.addEventListener("click", renameActiveCategory);
els.deleteCategoryBtn?.addEventListener("click", deleteActiveCategory);
els.exportBtn.addEventListener("click", exportMemories);
els.importInput.addEventListener("change", importMemories);

async function summarizeAndSave() {
  const apiKey = els.apiKey.value.trim();
  const videoUrl = els.youtubeUrl.value.trim();
  const model = els.modelName.value.trim() || "gemini-3.5-flash";
  const summaryLength = els.summaryLength.value;
  const selectedCategory = els.category.value;

  if (!apiKey && !serverGeminiKeyAvailable) {
    setStatus("Add a Gemini API key first.", true);
    return;
  }

  if (!isYouTubeUrl(videoUrl)) {
    setStatus("Paste a public YouTube link.", true);
    return;
  }

  setBusy(true);
  setStatus("Asking Gemini to watch, structure, and summarize the video...");

  try {
    const result = await callGemini({
      apiKey,
      videoUrl,
      model,
      prompt: buildPrompt({
        basePrompt: els.prompt.value,
        summaryLength,
        selectedCategory,
      }),
    });
    const parsed = parseGeminiJson(result);
    const now = new Date().toISOString();
    const memory = {
      id: createId(),
      url: videoUrl,
      model,
      createdAt: now,
      updatedAt: now,
      tags: [],
      relatedIds: [],
      summaryLength,
      rawText: result,
      ...normalizeSummary(parsed),
    };
    memory.tags = uniqueList([...parseTags(els.tags.value), ...memory.tags]);
    if (selectedCategory !== "auto") memory.category = selectedCategory;

    memories = [memory, ...memories];
    selectedId = memory.id;
    saveMemories();
    els.youtubeUrl.value = "";
    els.category.value = "auto";
    els.tags.value = "";
    setStatus("Saved. It is searchable now.");
    render();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while summarizing.", true);
  } finally {
    setBusy(false);
  }
}

async function initRemoteSync() {
  if (!["http:", "https:"].includes(location.protocol)) return;

  try {
    const [memoryResponse, configResponse] = await Promise.all([
      fetch("/api/memories", { cache: "no-store" }),
      fetch("/api/config", { cache: "no-store" }),
    ]);
    const config = configResponse.ok ? await configResponse.json() : {};
    serverGeminiKeyAvailable = Boolean(config.hasServerGeminiKey);
    updateApiKeyUi();

    const response = memoryResponse;
    if (!response.ok) return;
    const remoteMemories = await response.json();
    if (!Array.isArray(remoteMemories)) return;

    serverSyncAvailable = true;
    memories = mergeMemories(memories, remoteMemories);
    selectedId = selectedId ?? memories[0]?.id ?? null;
    saveMemories();
    render();
    setStatus(serverGeminiKeyAvailable ? "Shared server memory is on. Server Gemini key is ready." : "Shared server memory is on.");
  } catch {
    serverSyncAvailable = false;
  }
}

function updateApiKeyUi() {
  if (!serverGeminiKeyAvailable) return;
  els.apiKey.placeholder = "Using server key";
  els.apiKey.required = false;
  els.saveKeyBtn.disabled = true;
  els.saveKeyBtn.textContent = "Server key active";
}

function buildPrompt({ basePrompt, summaryLength, selectedCategory }) {
  const lengthInstruction =
    summaryLength === "long"
      ? "Write a long, detailed summary: 350-550 words, 5-10 sections, and detailed points. Also provide Hebrew equivalents for the whole output, including every section and bullet."
      : "Write a short, concise summary: 90-140 words, 3-5 sections, and brief points. Also provide Hebrew equivalents for the whole output, including every section and bullet.";
  const categoryInstruction =
    selectedCategory === "auto"
      ? "Choose one English category that best describes the video."
      : `Use this exact English category: ${selectedCategory}.`;

  return `${basePrompt}

Summary length: ${summaryLength}.
${lengthInstruction}
${categoryInstruction}
English tags should be short and useful for search. Hebrew tags must be natural Hebrew equivalents, not transliterations unless a transliteration is the standard term. The Hebrew section fields must match the English section structure one-to-one.`;
}

async function callGemini({ apiKey, videoUrl, model, prompt }) {
  if (["http:", "https:"].includes(location.protocol)) {
    const response = await fetchWithTimeout("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, videoUrl, model, prompt }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `Gemini returned ${response.status}.`);
    }
    if (!body.text) {
      throw new Error("Gemini did not return a summary.");
    }
    return body.text;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              file_data: {
                file_uri: videoUrl,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || `Gemini returned ${response.status}.`;
    throw new Error(message);
  }

  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini did not return a summary.");
  }
  return text;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request took too long. Try a shorter summary or check the server terminal for errors.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseGeminiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const json = firstJsonObject(text);
    if (!json) throw new Error("Gemini returned text, but not JSON. Try again or make the prompt stricter.");
    return JSON.parse(json);
  }
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return "";
}

function normalizeSummary(summary) {
  return {
    title: clean(summary.title) || "Untitled video",
    titleHe: clean(summary.titleHe),
    oneSentence: clean(summary.oneSentence),
    oneSentenceHe: clean(summary.oneSentenceHe),
    overview: clean(summary.overview),
    overviewHe: clean(summary.overviewHe),
    category: clean(summary.category) || "Other",
    sections: Array.isArray(summary.sections)
      ? summary.sections.map((section) => ({
          title: clean(section.title) || "Section",
          titleHe: clean(section.titleHe),
          timestamp: clean(section.timestamp),
          summary: clean(section.summary),
          summaryHe: clean(section.summaryHe),
          keyPoints: toStringArray(section.keyPoints),
          keyPointsHe: toStringArray(section.keyPointsHe),
        }))
      : [],
    importantIdeas: toStringArray(summary.importantIdeas),
    importantIdeasHe: toStringArray(summary.importantIdeasHe),
    actionItems: toStringArray(summary.actionItems).filter((item) => item.toLowerCase() !== "null"),
    actionItemsHe: toStringArray(summary.actionItemsHe).filter((item) => item.toLowerCase() !== "null"),
    keywords: toStringArray(summary.keywords),
    tags: toStringArray(summary.tags),
    tagsHe: toStringArray(summary.tagsHe),
  };
}

function render() {
  const query = els.searchInput.value.trim().toLowerCase();
  const searched = memories.filter((memory) => memoryMatches(memory, query));
  const filtered =
    activeCategory === "All" ? searched : searched.filter((memory) => normalizeCategory(memory.category) === activeCategory);

  els.memoryCount.textContent = `${memories.length} saved`;
  renderCategorySelect();
  els.categoryNav.innerHTML = categoryButtons(searched);
  els.renameCategoryBtn.disabled = activeCategory === "All";
  els.deleteCategoryBtn.disabled = activeCategory === "All";
  els.memoryList.innerHTML = filtered.length
    ? categoryGroups(filtered, query)
    : `<div class="empty-state"><p>No matching memories.</p></div>`;

  els.categoryNav.querySelectorAll(".category-tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      selectedId = null;
      render();
    });
  });

  els.memoryList.querySelectorAll(".memory-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedId = card.dataset.id;
      render();
    });
  });

  const selected = memories.find((memory) => memory.id === selectedId) ?? filtered[0];
  if (selected) {
    selectedId = selected.id;
    els.memoryDetail.innerHTML = memoryDetail(selected, query);
    wireDetailActions(selected);
  } else {
    els.memoryDetail.innerHTML = `<div class="empty-state"><h2>No memory selected</h2><p>Paste a video link, ask Gemini for a structured summary, then search it here later.</p></div>`;
  }
}

function categoryButtons(filteredMemories) {
  const counts = new Map();
  filteredMemories.forEach((memory) => {
    const category = normalizeCategory(memory.category);
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const allCategories = getAllCategories();
  const categories = ["All", ...allCategories.filter((category) => counts.has(category) || customCategories.includes(category))];
  const extras = [...counts.keys()].filter((category) => !allCategories.includes(category)).sort();
  categories.push(...extras);

  return categories
    .map((category) => {
      const count = category === "All" ? filteredMemories.length : counts.get(category) || 0;
      const active = category === activeCategory ? " active" : "";
      return `<button type="button" class="category-tab${active}" data-category="${escapeHtml(category)}">${escapeHtml(category)} <span>${count}</span></button>`;
    })
    .join("");
}

function categoryGroups(filtered, query) {
  if (activeCategory !== "All") return filtered.map((memory) => memoryCard(memory, query)).join("");

  const byCategory = new Map();
  filtered.forEach((memory) => {
    const category = normalizeCategory(memory.category);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(memory);
  });

  const ordered = [
    ...getAllCategories().filter((category) => byCategory.has(category)),
    ...[...byCategory.keys()].filter((category) => !getAllCategories().includes(category)).sort(),
  ];

  return ordered
    .map(
      (category) => `<section class="category-group">
        <h2>${escapeHtml(category)}</h2>
        ${byCategory.get(category).map((memory) => memoryCard(memory, query)).join("")}
      </section>`,
    )
    .join("");
}

function memoryCard(memory, query) {
  const active = memory.id === selectedId ? " active" : "";
  const date = new Date(memory.createdAt).toLocaleDateString();
  return `<button class="memory-card${active}" data-id="${escapeHtml(memory.id)}">
    <h3>${highlight(memory.title, query)}</h3>
    ${memory.titleHe ? `<div class="meta hebrew-line" dir="rtl" lang="he">${highlight(memory.titleHe, query)}</div>` : ""}
    <div class="meta">${date} · ${escapeHtml(memory.category || "Other")} · ${memory.summaryLength === "long" ? "Long" : "Short"}${(memory.relatedIds || []).length ? ` · ${(memory.relatedIds || []).length} linked` : ""}</div>
    <div class="card-summary">${highlight(memory.oneSentence || memory.overview || "", query)}</div>
    <div class="tag-row">${[memory.category, ...(memory.tags || []), ...(memory.tagsHe || []), ...(memory.keywords || []).slice(0, 3)].filter(Boolean).map((tag) => `<span class="tag">${highlight(tag, query)}</span>`).join("")}</div>
  </button>`;
}

function memoryDetail(memory, query) {
  return `<div class="detail-header">
    <div>
      <a class="video-link" href="${escapeHtml(memory.url)}" target="_blank" rel="noreferrer">Open video</a>
      <h2>${highlight(memory.title, query)}</h2>
      <p>${highlight(memory.oneSentence || "", query)}</p>
      ${memory.titleHe || memory.oneSentenceHe ? `<div class="hebrew-access" dir="rtl" lang="he">
        ${memory.titleHe ? `<h3>${highlight(memory.titleHe, query)}</h3>` : ""}
        ${memory.oneSentenceHe ? `<p>${highlight(memory.oneSentenceHe, query)}</p>` : ""}
      </div>` : ""}
    </div>
    <div class="detail-actions">
      <button type="button" id="copyMarkdownBtn">Copy Markdown</button>
      <button type="button" id="deleteMemoryBtn">Delete</button>
    </div>
    <div class="category-editor">
      <label>
        Move to category
        <select id="memoryCategorySelect">${categoryOptionHtml(memory.category || "Other")}</select>
      </label>
      <button type="button" id="moveMemoryBtn">Move</button>
      <button type="button" id="newMemoryCategoryBtn">New category</button>
    </div>
    <div class="link-editor">
      <label>
        Link another memory
        <select id="relatedMemorySelect">${relatedMemoryOptionHtml(memory)}</select>
      </label>
      <button type="button" id="linkMemoryBtn">Link</button>
    </div>
    ${linkedMemoriesHtml(memory, query)}
    <div class="chips">${[memory.category, ...(memory.tags || []), ...(memory.tagsHe || []), ...(memory.keywords || [])].filter(Boolean).map((tag) => `<span class="chip">${highlight(tag, query)}</span>`).join("")}</div>
  </div>

  <section class="section">
    <h3>Overview</h3>
    <p>${highlight(memory.overview || "No overview returned.", query)}</p>
  </section>

  ${memory.overviewHe ? `<section class="section hebrew-summary" dir="rtl" lang="he">
    <h3>סיכום בעברית</h3>
    <p>${highlight(memory.overviewHe, query)}</p>
  </section>` : ""}

  ${(memory.sections || [])
    .map(
      (section) => `<section class="section">
        ${section.timestamp ? `<span class="section-time">${highlight(section.timestamp, query)}</span>` : ""}
        <h3>${highlight(section.title, query)}</h3>
        <p>${highlight(section.summary || "", query)}</p>
        ${bulletList(section.keyPoints, query)}
        ${section.titleHe || section.summaryHe || (section.keyPointsHe || []).length ? `<div class="hebrew-section" dir="rtl" lang="he">
          ${section.titleHe ? `<h3>${highlight(section.titleHe, query)}</h3>` : ""}
          ${section.summaryHe ? `<p>${highlight(section.summaryHe, query)}</p>` : ""}
          ${bulletList(section.keyPointsHe || [], query)}
        </div>` : ""}
      </section>`,
    )
    .join("")}

  ${ideaBlock("Important Ideas", memory.importantIdeas || [], query)}
  ${ideaBlock("רעיונות חשובים", memory.importantIdeasHe || [], query, true)}
  ${ideaBlock("Action Items", memory.actionItems || [], query)}
  ${ideaBlock("פעולות לביצוע", memory.actionItemsHe || [], query, true)}`;
}

function ideaBlock(title, items, query, isHebrew = false) {
  if (!items.length) return "";
  return `<section class="section${isHebrew ? " hebrew-summary" : ""}"${isHebrew ? ' dir="rtl" lang="he"' : ""}><h3>${title}</h3>${bulletList(items, query)}</section>`;
}

function bulletList(items, query) {
  if (!items.length) return "";
  return `<ul class="bullets">${items.map((item) => `<li>${highlight(item, query)}</li>`).join("")}</ul>`;
}

function wireDetailActions(memory) {
  document.querySelector("#deleteMemoryBtn")?.addEventListener("click", () => {
    const ok = confirm(`Delete "${memory.title}"?`);
    if (!ok) return;
    memories = memories
      .filter((item) => item.id !== memory.id)
      .map((item) => ({ ...item, relatedIds: (item.relatedIds || []).filter((id) => id !== memory.id) }));
    selectedId = memories[0]?.id ?? null;
    saveMemories();
    render();
  });

  document.querySelector("#copyMarkdownBtn")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(toMarkdown(memory));
    setStatus("Markdown copied.");
  });

  document.querySelector("#moveMemoryBtn")?.addEventListener("click", () => {
    const category = document.querySelector("#memoryCategorySelect")?.value;
    if (category) moveMemoryToCategory(memory.id, category);
  });

  document.querySelector("#newMemoryCategoryBtn")?.addEventListener("click", () => {
    const category = prompt("New category name");
    if (!category) return;
    const cleanCategory = addCustomCategory(category);
    if (!cleanCategory) return;
    moveMemoryToCategory(memory.id, cleanCategory);
  });

  document.querySelector("#linkMemoryBtn")?.addEventListener("click", () => {
    const relatedId = document.querySelector("#relatedMemorySelect")?.value;
    if (relatedId) linkMemories(memory.id, relatedId);
  });

  document.querySelectorAll("[data-related-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.relatedId;
      render();
    });
  });

  document.querySelectorAll("[data-unlink-id]").forEach((button) => {
    button.addEventListener("click", () => unlinkMemories(memory.id, button.dataset.unlinkId));
  });
}

function toMarkdown(memory) {
  const lines = [
    `# ${memory.title}`,
    "",
    memory.url,
    "",
    memory.oneSentence,
    "",
    `Category: ${memory.category || "Other"}`,
    "",
    "Tags: " + [...(memory.tags || []), ...(memory.keywords || [])].join(", "),
    "",
    memory.titleHe ? `Hebrew title: ${memory.titleHe}` : "",
    memory.oneSentenceHe ? `Hebrew one-sentence summary: ${memory.oneSentenceHe}` : "",
    "",
    "## Overview",
    memory.overview,
    "",
    memory.overviewHe ? "## Hebrew Summary" : "",
    memory.overviewHe || "",
    "",
    (memory.tagsHe || []).length ? `Hebrew tags: ${(memory.tagsHe || []).join(", ")}` : "",
    "",
    "## Sections",
  ];

  (memory.sections || []).forEach((section) => {
    lines.push("", `### ${section.timestamp ? `${section.timestamp} - ` : ""}${section.title}`, section.summary);
    (section.keyPoints || []).forEach((point) => lines.push(`- ${point}`));
    if (section.titleHe || section.summaryHe || (section.keyPointsHe || []).length) {
      lines.push("", `### ${section.timestamp ? `${section.timestamp} - ` : ""}${section.titleHe || "מקטע בעברית"}`);
      if (section.summaryHe) lines.push(section.summaryHe);
      (section.keyPointsHe || []).forEach((point) => lines.push(`- ${point}`));
    }
  });

  if ((memory.importantIdeas || []).length) {
    lines.push("", "## Important Ideas", ...memory.importantIdeas.map((idea) => `- ${idea}`));
  }

  if ((memory.importantIdeasHe || []).length) {
    lines.push("", "## רעיונות חשובים", ...memory.importantIdeasHe.map((idea) => `- ${idea}`));
  }

  if ((memory.actionItems || []).length) {
    lines.push("", "## Action Items", ...memory.actionItems.map((item) => `- ${item}`));
  }

  if ((memory.actionItemsHe || []).length) {
    lines.push("", "## פעולות לביצוע", ...memory.actionItemsHe.map((item) => `- ${item}`));
  }

  const linked = relatedMemories(memory);
  if (linked.length) {
    lines.push("", "## Linked Memories", ...linked.map((item) => `- ${item.title} (${item.url})`));
  }

  return lines.filter(Boolean).join("\n");
}

function memoryMatches(memory, query) {
  if (!query) return true;
  return searchableText(memory).includes(query);
}

function searchableText(memory) {
  return [
    memory.title,
    memory.titleHe,
    memory.oneSentence,
    memory.oneSentenceHe,
    memory.overview,
    memory.overviewHe,
    memory.category,
    memory.url,
    memory.model,
    ...(memory.tags || []),
    ...(memory.tagsHe || []),
    ...(memory.keywords || []),
    ...(memory.importantIdeas || []),
    ...(memory.importantIdeasHe || []),
    ...(memory.actionItems || []),
    ...(memory.actionItemsHe || []),
    ...relatedMemories(memory).flatMap((item) => [item.title, item.titleHe, item.category]),
    ...(memory.sections || []).flatMap((section) => [
      section.title,
      section.titleHe,
      section.timestamp,
      section.summary,
      section.summaryHe,
      ...(section.keyPoints || []),
      ...(section.keyPointsHe || []),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function relatedMemories(memory) {
  const ids = new Set(memory.relatedIds || []);
  return memories.filter((item) => ids.has(item.id));
}

function relatedMemoryOptionHtml(memory) {
  const linked = new Set(memory.relatedIds || []);
  const candidates = memories.filter((item) => item.id !== memory.id && !linked.has(item.id));
  if (!candidates.length) return `<option value="">No unlinked memories</option>`;
  return `<option value="">Choose a memory...</option>${candidates
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || "Untitled video")}</option>`)
    .join("")}`;
}

function linkedMemoriesHtml(memory, query) {
  const linked = relatedMemories(memory);
  if (!linked.length) {
    return `<section class="linked-memories"><h3>Linked memories</h3><p class="meta">No linked memories yet.</p></section>`;
  }

  return `<section class="linked-memories">
    <h3>Linked memories</h3>
    <div class="linked-list">
      ${linked
        .map(
          (item) => `<div class="linked-item">
            <button type="button" data-related-id="${escapeHtml(item.id)}">
              <span>${highlight(item.title || "Untitled video", query)}</span>
              <small>${escapeHtml(item.category || "Other")}</small>
            </button>
            <button type="button" class="unlink-button" data-unlink-id="${escapeHtml(item.id)}">Unlink</button>
          </div>`,
        )
        .join("")}
    </div>
  </section>`;
}

function linkMemories(firstId, secondId) {
  if (!firstId || !secondId || firstId === secondId) return;
  const now = new Date().toISOString();
  memories = memories.map((memory) => {
    if (![firstId, secondId].includes(memory.id)) return memory;
    const otherId = memory.id === firstId ? secondId : firstId;
    return {
      ...memory,
      relatedIds: uniqueList([...(memory.relatedIds || []), otherId]),
      updatedAt: now,
    };
  });
  saveMemories();
  render();
  setStatus("Linked memories.");
}

function unlinkMemories(firstId, secondId) {
  const now = new Date().toISOString();
  memories = memories.map((memory) => {
    if (![firstId, secondId].includes(memory.id)) return memory;
    return {
      ...memory,
      relatedIds: (memory.relatedIds || []).filter((id) => id !== firstId && id !== secondId),
      updatedAt: now,
    };
  });
  saveMemories();
  render();
  setStatus("Unlinked memories.");
}

function normalizeCategory(category) {
  const value = clean(category) || "Other";
  const match = baseCategories.find((item) => item.toLowerCase() === value.toLowerCase());
  return match || value;
}

function getAllCategories() {
  const memoryCategories = memories.map((memory) => normalizeCategory(memory.category));
  return uniqueList([...baseCategories, ...customCategories, ...memoryCategories]).sort((a, b) => {
    const aBase = baseCategories.indexOf(a);
    const bBase = baseCategories.indexOf(b);
    if (aBase !== -1 || bBase !== -1) {
      if (aBase === -1) return 1;
      if (bBase === -1) return -1;
      return aBase - bBase;
    }
    return a.localeCompare(b);
  });
}

function renderCategorySelect() {
  const current = els.category.value || "auto";
  els.category.innerHTML = `<option value="auto">Automatic</option>${categoryOptionHtml(current)}`;
  els.category.value = current === "auto" || getAllCategories().includes(current) ? current : "auto";
}

function categoryOptionHtml(selected = "") {
  return getAllCategories()
    .map((category) => `<option value="${escapeHtml(category)}"${category === selected ? " selected" : ""}>${escapeHtml(category)}</option>`)
    .join("");
}

function addCategory() {
  const category = prompt("New category name");
  if (!category) return;
  const cleanCategory = addCustomCategory(category);
  if (!cleanCategory) return;
  activeCategory = cleanCategory;
  render();
  setStatus(`Added category "${cleanCategory}".`);
}

function addCustomCategory(category) {
  const cleanCategory = clean(category);
  if (!cleanCategory) return "";
  const existing = getAllCategories().find((item) => item.toLowerCase() === cleanCategory.toLowerCase());
  const finalCategory = existing || cleanCategory;
  if (!customCategories.includes(finalCategory) && !baseCategories.includes(finalCategory)) {
    customCategories = uniqueList([...customCategories, finalCategory]);
    saveCustomCategories();
  }
  return finalCategory;
}

function renameActiveCategory() {
  if (activeCategory === "All") return;
  const next = prompt("Rename category", activeCategory);
  if (!next) return;
  const cleanNext = clean(next);
  if (!cleanNext || cleanNext === activeCategory) return;

  memories = memories.map((memory) =>
    normalizeCategory(memory.category) === activeCategory
      ? { ...memory, category: cleanNext, updatedAt: new Date().toISOString() }
      : memory,
  );
  customCategories = uniqueList(customCategories.map((category) => (category === activeCategory ? cleanNext : category)));
  if (!customCategories.includes(cleanNext) && !baseCategories.includes(cleanNext)) {
    customCategories.push(cleanNext);
  }
  saveCustomCategories();
  activeCategory = cleanNext;
  saveMemories();
  render();
  setStatus(`Renamed category to "${cleanNext}".`);
}

function deleteActiveCategory() {
  if (activeCategory === "All") return;
  const count = memories.filter((memory) => normalizeCategory(memory.category) === activeCategory).length;
  const ok = confirm(
    `Delete category "${activeCategory}"? ${count ? `Its ${count} memories will be moved to "Other".` : "No memories will be deleted."}`,
  );
  if (!ok) return;

  const now = new Date().toISOString();
  memories = memories.map((memory) =>
    normalizeCategory(memory.category) === activeCategory ? { ...memory, category: "Other", updatedAt: now } : memory,
  );
  customCategories = customCategories.filter((category) => category !== activeCategory);
  saveCustomCategories();
  activeCategory = "Other";
  saveMemories();
  render();
  setStatus(`Deleted category. ${count ? `Moved ${count} memories to "Other".` : ""}`);
}

function moveMemoryToCategory(memoryId, category) {
  const cleanCategory = addCustomCategory(category);
  if (!cleanCategory) return;
  memories = memories.map((memory) =>
    memory.id === memoryId ? { ...memory, category: cleanCategory, updatedAt: new Date().toISOString() } : memory,
  );
  activeCategory = cleanCategory;
  saveMemories();
  render();
  setStatus(`Moved memory to "${cleanCategory}".`);
}

function mergeMemories(localMemories, remoteMemories) {
  const byId = new Map();
  [...remoteMemories, ...localMemories].forEach((memory) => {
    if (!memory?.id) return;
    const existing = byId.get(memory.id);
    if (!existing || (memory.updatedAt || memory.createdAt || "") > (existing.updatedAt || existing.createdAt || "")) {
      byId.set(memory.id, memory);
    }
  });
  return [...byId.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function uniqueList(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function loadCustomCategories() {
  try {
    return JSON.parse(localStorage.getItem(categoryStorageKey) || "[]");
  } catch {
    return [];
  }
}

function saveCustomCategories() {
  localStorage.setItem(categoryStorageKey, JSON.stringify(customCategories));
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const randomValues = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)))
    : [Math.random() * 2 ** 32, Math.random() * 2 ** 32, Math.random() * 2 ** 32, Math.random() * 2 ** 32];

  return [
    Date.now().toString(36),
    ...randomValues.map((value) => Math.floor(value).toString(36).padStart(7, "0")),
  ].join("-");
}

function exportMemories() {
  const blob = new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `youtube-memories-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importMemories(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error("Import file must contain a memory array.");
    const byId = new Map([...incoming, ...memories].map((memory) => [memory.id, memory]));
    memories = [...byId.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    selectedId = memories[0]?.id ?? null;
    saveMemories();
    render();
    setStatus("Imported memories.");
  } catch (error) {
    setStatus(error.message || "Could not import that file.", true);
  } finally {
    event.target.value = "";
  }
}

function loadMemories() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    return [];
  }
}

function saveMemories() {
  localStorage.setItem(storageKey, JSON.stringify(memories));
  if (serverSyncAvailable) {
    fetch("/api/memories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memories),
    }).catch(() => {
      serverSyncAvailable = false;
      setStatus("Shared server memory is offline. Saving in this browser for now.", true);
    });
  }
}

function setBusy(isBusy) {
  els.summarizeBtn.disabled = isBusy;
  els.summarizeBtn.textContent = isBusy ? "Summarizing..." : "Summarize & save";
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function highlight(value, query) {
  const safe = escapeHtml(value ?? "");
  if (!query) return safe;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${escapedQuery})`, "gi"), "<mark>$1</mark>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
