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
  INLINE_IMAGE_ROUTE,
  MAX_IMAGE_BYTES,
} from "@/lib/html/inline-image";

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

        if (images.length === 0) return false;

        event.preventDefault();
        void insertImages(images);
        return true;
      },

      handleDrop: (_view, event) => {
        const files = Array.from(
          (event as DragEvent).dataTransfer?.files ?? [],
        );
        const images = files.filter((file) => file.type.startsWith("image/"));

        if (images.length === 0) return false;

        event.preventDefault();
        void insertImages(images);
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
      setImageError(
        error instanceof Error ? error.message : "The image could not be added.",
      );
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
