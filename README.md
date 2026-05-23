# YouTube Memory

A local browser tool for turning YouTube links into sectioned, searchable memories with Gemini.

## Use It

Open `index.html` in your browser. It is self-contained, so you can move or download that single file and the styling will stay with it.

You can also run:

```bash
node server.mjs
```

Then open `http://localhost:4173`.

On Mac, you can double-click `Start YouTube Memory.command` instead of typing Terminal commands. Keep the window open while using the app.

When using the server, memories are shared through `memories.json` in this folder. The terminal also prints Wi-Fi URLs like `http://192.168.x.x:4173`; open one of those on your iPhone or another computer on the same network to use the same memory library.

On the server URL, Gemini requests go through the local server at `/api/gemini`. If you change the app code while the server is running, stop it with `Ctrl+C` and run `node server.mjs` again.

To avoid typing your Gemini API key on every device, create a `.env` file in this folder:

```bash
cp .env.example .env
```

Edit `.env` and replace the placeholder with your real key:

```text
GEMINI_API_KEY=your-real-key-here
```

Then restart the server. Devices that open the server URL will use the server key automatically.

## How It Works

1. Paste a Gemini API key.
2. Paste a public YouTube URL.
3. Choose a short or long summary.
4. Pick a category or let Gemini choose one.
5. Gemini returns English memory content plus Hebrew access fields for title, summary, every section, section bullets, important ideas, action items, and tags.
6. The memory is saved in this browser with `localStorage`.
7. Search looks across English and Hebrew titles, summaries, sections, categories, keywords, tags, and action items.
8. Categories can be added, renamed, and used to move saved memories between groups.

## Notes

- If `.env` contains `GEMINI_API_KEY`, devices using the server URL do not need their own browser key.
- If you open `index.html` directly as a file, the API key is stored only in that browser if you click "Save key locally".
- Shared server memory works when devices access the app from the same running server. If you open `index.html` directly as a file, it uses that browser's local storage only.
- Access from anywhere outside your home/office network would require hosting this app or connecting it to a cloud database.
- Memories can be exported and imported as JSON.
- Public YouTube URL support is based on Gemini API video understanding docs:
  https://ai.google.dev/gemini-api/docs/video-understanding
