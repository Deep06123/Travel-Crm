"use client";

import { Color } from "@tiptap/extension-color";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  ImagePlus,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  ALLOWED_IMAGE_TYPES,
  INLINE_IMAGE_IMPORT_ROUTE,
  INLINE_IMAGE_ROUTE,
  MAX_IMAGE_BYTES,
} from "@/lib/html/inline-image";
import {
  applyResolvedSources,
  collectImageSources,
  dataUrlToFile,
  parsePastedHtml,
} from "@/lib/html/paste-images";

import { cn } from "@/lib/utils";

/**
 * Rich-text editor for itinerary text.
 *
 * The editor keeps its own document and mirrors it into a hidden input on
 * every change, so the surrounding plain `<form>` submits it like any other
 * field — no client-side submit handler, and the form still works the way
 * every other form in this application does.
 *
 * What it produces is HTML, which is the one kind of value this application
 * stores as markup rather than escaping. It is therefore sanitised on the
 * server before storage (`src/lib/html/sanitise.ts`). Nothing here is a
 * security measure: the toolbar only decides what is convenient to type, and
 * an action is reachable with any body at all.
 */

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded [&_svg]:size-4",
        active
          ? "bg-navy-500 text-white"
          : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />;
}

/**
 * Sends one image to the server and returns the URL to embed.
 *
 * The bytes go to storage rather than into the document. The markup lives in a
 * MySQL `TEXT` column — 65,535 bytes — and a single screenshot inlined as a
 * data URI would exceed that on its own, so the save would fail with a
 * truncation error rather than anything that reads like the real cause.
 */
async function uploadImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only PNG, JPEG, WebP and GIF images can be added.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`,
    );
  }

  const body = new FormData();
  body.append("file", file);

  const response = await fetch(INLINE_IMAGE_ROUTE, { method: "POST", body });

  // Both checks are repeated on the server, which is where they count; these
  // only save a round trip and give a better message.
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(detail?.error ?? "The image could not be uploaded.");
  }

  const { url } = (await response.json()) as { url: string };
  return url;
}

/** One image's fate at the import route. */
interface ImportedImage {
  source: string;
  url: string | null;
  error?: string;
}

/**
 * Asks the server to re-host images the operator pasted a reference to.
 *
 * The bytes cannot be fetched from here: the carrier's host does not permit a
 * cross-origin read, and even where it did the browser would be downloading on
 * behalf of a page that only needs the result stored. The server does it, under
 * the guards in `src/lib/html/remote-image.ts`.
 *
 * All of them in one request. A pasted page routinely carries a dozen images,
 * and a round trip apiece would leave the editor empty for long enough to look
 * broken.
 */
async function importRemoteImages(
  urls: readonly string[],
): Promise<ImportedImage[]> {
  const response = await fetch(INLINE_IMAGE_IMPORT_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(detail?.error ?? "The images could not be imported.");
  }

  const { results } = (await response.json()) as { results: ImportedImage[] };
  return results;
}

/** What an operator is told when part of a paste did not survive it. */
function describeDropped(count: number, reasons: readonly string[]): string {
  const subject =
    count === 1 ? "One image could not be added" : `${count} images could not be added`;

  // The distinct reasons, not one line per failed image: a page whose pictures
  // all sit behind the same login would otherwise print the same sentence ten
  // times.
  const distinct = [...new Set(reasons)];

  return distinct.length > 0
    ? `${subject}: ${distinct.join(" ")}`
    : `${subject} and were left out.`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "The image could not be added.";
}

function Toolbar({
  editor,
  onInsertImage,
  uploading,
}: {
  editor: Editor;
  onInsertImage: () => void;
  uploading: boolean;
}) {
  const addLink = () => {
    const previous = editor.getAttributes("link")["href"] as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");

    // Cancelled: leave the document untouched rather than clearing the link.
    if (url === null) return;

    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-muted px-2 py-1.5">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Superscript"
        active={editor.isActive("superscript")}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon />
      </ToolbarButton>
      <ToolbarButton
        label="Subscript"
        active={editor.isActive("subscript")}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft />
      </ToolbarButton>
      <ToolbarButton
        label="Align centre"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter />
      </ToolbarButton>
      <ToolbarButton
        label="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <TableIcon />
      </ToolbarButton>
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={addLink}>
        <Link2 />
      </ToolbarButton>
      <ToolbarButton
        label={uploading ? "Uploading image…" : "Insert image"}
        onClick={onInsertImage}
      >
        <ImagePlus className={uploading ? "animate-pulse" : undefined} />
      </ToolbarButton>

      <label className="ml-1 flex items-center gap-1" title="Text colour">
        <span className="sr-only">Text colour</span>
        <input
          type="color"
          className="size-6 cursor-pointer rounded border border-line bg-white p-0.5"
          onChange={(event) =>
            editor.chain().focus().setColor(event.target.value).run()
          }
        />
      </label>

      <Divider />

      <ToolbarButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  name,
  defaultValue,
  placeholder,
  minHeight = 220,
}: {
  /** Form field the HTML is submitted under. */
  name: string;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  minHeight?: number;
}) {
  const [html, setHtml] = useState(defaultValue ?? "");
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    // Rendered on the client only. Without this React warns about the server
    // and client markup disagreeing, because the editor builds its DOM itself.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      // Not part of StarterKit; an itinerary occasionally needs them for
      // fare-basis and footnote markers.
      Superscript,
      Subscript,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: false }),
      TableKit.configure({ table: { resizable: true } }),
      // `allowBase64` is off: a pasted screenshot must go through the upload,
      // not into the document. The markup is stored in a MySQL TEXT column,
      // and one inlined image would exceed it.
      Image.configure({ allowBase64: false, inline: false }),
    ],
    content: defaultValue ?? "",
    editorProps: {
      attributes: {
        class: "prose-itinerary focus:outline-none",
        style: `min-height:${minHeight}px`,
      },

      // Pasting a screenshot is how these actually arrive — an agent takes one
      // of the carrier's confirmation and pastes it straight in. Intercepted
      // so the bytes are uploaded rather than inlined, which would both
      // overflow the column and be stripped on save.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const images = files.filter((file) => file.type.startsWith("image/"));

        if (images.length > 0) {
          event.preventDefault();
          void insertImages(images);
          return true;
        }

        // Copying a region of the carrier's booking page puts no files on the
        // clipboard at all — it puts that page's markup there, with the
        // carrier's own image URLs in it. Left alone, those render here (the
        // browser simply fetches them) and then vanish on save, because the
        // sanitiser refuses any `src` this application did not issue. So the
        // images are re-hosted before the markup is inserted, and what the
        // operator sees in the editor is what the booking will actually keep.
        const html = event.clipboardData?.getData("text/html") ?? "";

        if (!html.includes("<img")) return false;

        event.preventDefault();
        void insertPastedHtml(html);
        return true;
      },

      handleDrop: (_view, event) => {
        const transfer = (event as DragEvent).dataTransfer;
        const files = Array.from(transfer?.files ?? []);
        const images = files.filter((file) => file.type.startsWith("image/"));

        if (images.length > 0) {
          event.preventDefault();
          void insertImages(images);
          return true;
        }

        // Dragging an image out of another tab carries markup, not a file —
        // the same shape as the paste above, and re-hosted the same way.
        const html = transfer?.getData("text/html") ?? "";

        if (!html.includes("<img")) return false;

        event.preventDefault();
        void insertPastedHtml(html);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => setHtml(instance.getHTML()),
  });

  /**
   * Uploads each image and places it in the document.
   *
   * Sequential rather than parallel: pasting several at once would otherwise
   * open as many requests, and they land in the order they were given, which
   * is the order the agent expects to see them.
   */
  async function insertImages(files: readonly File[]): Promise<void> {
    if (!editor) return;

    setImageError(null);
    setUploading(true);

    try {
      for (const file of files) {
        const src = await uploadImage(file);
        editor.chain().focus().setImage({ src, alt: file.name }).run();
      }

      // `setImage` does not pass through `onUpdate` in every path, so the
      // mirrored field is refreshed explicitly — otherwise the form would
      // submit markup without the image just added.
      setHtml(editor.getHTML());
    } catch (error) {
      setImageError(messageFor(error));
    } finally {
      setUploading(false);
    }
  }

  /**
   * Inserts pasted markup with every image re-hosted first.
   *
   * The rewriting happens on a detached document rather than on what is
   * already in the editor, so a failed import never half-edits the itinerary:
   * either the inserted markup is complete and self-hosted, or the images that
   * could not be brought across are absent and the operator is told which.
   */
  async function insertPastedHtml(html: string): Promise<void> {
    if (!editor) return;

    setImageError(null);
    setUploading(true);

    try {
      const doc = parsePastedHtml(html);
      const { remote, data } = collectImageSources(doc, window.location.origin);

      const resolved = new Map<string, string | null>();
      const reasons: string[] = [];

      // `data:` first, because it needs no network: the bytes came in on the
      // clipboard and only have to be stored.
      for (const [index, uri] of data.entries()) {
        const file = dataUrlToFile(uri, index);

        if (!file) {
          resolved.set(uri, null);
          reasons.push("Only PNG, JPEG, WebP and GIF images can be added.");
          continue;
        }

        try {
          resolved.set(uri, await uploadImage(file));
        } catch (error) {
          resolved.set(uri, null);
          reasons.push(messageFor(error));
        }
      }

      if (remote.length > 0) {
        try {
          for (const result of await importRemoteImages(remote)) {
            resolved.set(result.source, result.url);
            if (!result.url && result.error) reasons.push(result.error);
          }
        } catch (error) {
          // The request itself failed, so nothing in it resolved. Recorded one
          // by one rather than thrown, so the text of the paste still lands.
          for (const source of remote) resolved.set(source, null);
          reasons.push(messageFor(error));
        }
      }

      const dropped = applyResolvedSources(doc, resolved);

      editor.chain().focus().insertContent(doc.body.innerHTML).run();
      setHtml(editor.getHTML());

      if (dropped > 0) setImageError(describeDropped(dropped, reasons));
    } catch (error) {
      setImageError(messageFor(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-white">
      {editor ? (
        <Toolbar
          editor={editor}
          uploading={uploading}
          onInsertImage={() => fileInput.current?.click()}
        />
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={[...ALLOWED_IMAGE_TYPES].join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = "";
          if (files.length > 0) void insertImages(files);
        }}
      />

      <div className="px-3 py-2 text-sm">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          // Shown for the moment before the editor mounts, so the panel does
          // not jump in height.
          <div style={{ minHeight }} className="text-ink-subtle">
            {placeholder ?? ""}
          </div>
        )}
      </div>

      {imageError ? (
        <p
          role="alert"
          className="border-t border-line bg-status-danger-bg px-3 py-2 text-xs text-status-danger"
        >
          {imageError}
        </p>
      ) : null}

      {/* The editor's document is not a form control, so it is mirrored here
          for the surrounding form to submit. */}
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
