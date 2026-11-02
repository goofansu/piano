import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { downloadWorkspaceFile, place, readWorkspaceFile } from "../server/WorkspaceFiles.ts";
import { previewKindByName, previewKindsByExtension } from "../shared/files.ts";

test("file reads accept explicit external paths, stay bounded and never guess another workspace", async () => {
  // macOS's temporary directory can be an alias (/var -> /private/var).
  // Keep this fixture canonical; directory/leaf alias behavior is exercised below.
  const root = await realpath(await mkdtemp(join(tmpdir(), "piano-files-")));
  try {
    const a = join(root, "a"),
      b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const workspace = { id: "a", folder: a, path: a };
    await writeFile(join(a, "readme.txt"), "workspace A\n");
    await writeFile(join(b, "readme.txt"), "workspace B\n");
    await writeFile(join(a, "empty"), "");
    await writeFile(join(a, "binary"), Buffer.from([0, 1, 2]));
    await writeFile(join(a, "invalid-utf8"), Buffer.from([255]));
    await writeFile(join(a, "large"), "a".repeat(1024 * 1024 + 1));
    await symlink(join(b, "readme.txt"), join(a, "outside"));
    await symlink(join(a, "readme.txt"), join(a, "inside"));
    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    assert.deepEqual(await read("readme.txt"), {
      workspaceId: "a",
      path: "readme.txt",
      kind: "text",
      language: "",
      content: "workspace A\n",
    });
    assert.equal(
      ((await read(join(a, "readme.txt"))) as { content: string }).content,
      "workspace A\n",
    );
    assert.equal(((await read("inside")) as { content: string }).content, "workspace A\n");
    assert.equal(((await read("empty")) as { content: string }).content, "");
    for (const [path, name] of [
      ["../b/readme.txt", join(b, "readme.txt")],
      [join(b, "readme.txt"), join(b, "readme.txt")],
      ["outside", "outside"],
    ]) {
      assert.deepEqual(await read(path), {
        workspaceId: "a",
        path: name,
        kind: "text",
        language: "",
        content: "workspace B\n",
      });
      const download = await Effect.runPromise(downloadWorkspaceFile(workspace, path));
      assert.equal(new TextDecoder().decode(download.bytes), "workspace B\n");
    }
    for (const path of ["", "  ", "bad\0path"])
      await assert.rejects(read(path), /Choose a file path/);
    await writeFile(join(b, "only-in-b.txt"), "do not guess\n");
    await assert.rejects(read("only-in-b.txt"), /Check the path and read permissions/);
    for (const path of ["binary", "invalid-utf8"]) await assert.rejects(read(path), /UTF-8 text/);
    await assert.rejects(read("large"), /too large/);
    await assert.rejects(read("."), /regular file/);
    await assert.rejects(read("missing"), /Check the path and read permissions/);

    for (const [name, kind, language] of [
      ["guide.MD", "markdown", "markdown"],
      ["main.tsx", "text", "tsx"],
      ["Dockerfile", "text", "dockerfile"],
      ["settings.yml", "text", "yaml"],
      ["data.json", "text", "json"],
      ["output.log", "text", ""],
      ["image.svg", "svg", "xml"],
      ["image.SVG", "svg", "xml"],
      ["index.html", "text", "html"],
    ]) {
      const content = name.toLowerCase().endsWith("svg")
        ? '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        : "source\n";
      await writeFile(join(a, name), content);
      assert.deepEqual(await read(name), { workspaceId: "a", path: name, kind, language, content });
    }
    // SVG remains bounded UTF-8 text; only its presentation changes.
    await writeFile(join(a, "invalid.svg"), Buffer.from([255]));
    await assert.rejects(read("invalid.svg"), /UTF-8 text/);
    await writeFile(join(a, "large.svg"), "a".repeat(1024 * 1024 + 1));
    await assert.rejects(read("large.svg"), /too large/);
    await writeFile(join(a, "fake.png"), "not an image");
    await assert.rejects(read("fake.png"), /malformed/);
    // PNG bytes, not the extension, establish the binary type. The binary payload is lossless.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(a, "image.txt"), png);
    const image = await read("image.txt");
    assert.equal(image.kind, "image");
    assert.ok("bytes" in image);
    assert.equal(image.mime, "image/png");
    assert.deepEqual(image.bytes, png);
    await symlink(join(b, "readme.txt"), join(a, "escaped.png"));
    await assert.rejects(read("escaped.png"), /malformed/);
    await truncate(join(a, "image.txt"), 10 * 1024 * 1024 + 1);
    await assert.rejects(read("image.txt"), /image file up to 10 MiB/);
    await writeFile(join(a, "large.pdf"), "%PDF-1.7\n");
    await truncate(join(a, "large.pdf"), 20 * 1024 * 1024 + 1);
    await assert.rejects(read("large.pdf"), /pdf file up to 20 MiB/);
    await writeFile(
      join(a, "program.md"),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...new Array(100).fill(0)]),
    );
    await assert.rejects(read("program.md"), /not supported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("placement resolves directory aliases but preserves leaf symlinks and bounded reads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piano-placement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const alias = join(root, "root-alias");
  const outside = join(root, "outside");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(outside, "secret"), "not workspace content\n");
  await symlink(repo, alias);
  await symlink("src", join(repo, "alias"));
  await symlink(outside, join(repo, "external"));
  await symlink("a.ts", join(repo, "src/leaf.ts"));
  await symlink(join(outside, "secret"), join(repo, "src/external-leaf"));
  await symlink("missing", join(repo, "src/dangling-leaf"));

  for (const workspacePath of [repo, alias]) {
    const workspace = { id: "scratch", folder: repo, path: workspacePath };
    for (const path of [
      "src/a.ts",
      "alias/a.ts",
      join(repo, "alias/a.ts"),
      join(alias, "alias/a.ts"),
    ])
      assert.equal(await place(workspace, path), "src/a.ts", path);
    assert.equal(await place(workspace, "alias/not-yet/deleted.ts"), "src/not-yet/deleted.ts");
    assert.equal(await place(workspace, "missing/child.ts"), "missing/child.ts");
    assert.equal(await place(workspace, "external/secret"), undefined);
    assert.equal(await place(workspace, "external/not-yet/file"), undefined);
    assert.equal(await place(workspace, "../outside/secret"), undefined);
    for (const leaf of ["leaf.ts", "external-leaf", "dangling-leaf"])
      assert.equal(await place(workspace, `alias/${leaf}`), `src/${leaf}`);

    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    assert.deepEqual(await read("alias/a.ts"), await read("src/a.ts"));
    assert.equal((await read("alias/leaf.ts")).path, "src/leaf.ts");
    for (const [path, name] of [
      ["external/secret", join(workspacePath, "external/secret")],
      ["alias/external-leaf", "src/external-leaf"],
    ]) {
      const preview = await read(path);
      assert.equal(preview.path, name);
      assert.ok("content" in preview);
      assert.equal(preview.content, "not workspace content\n");
    }
    await assert.rejects(read("alias/dangling-leaf"), /Check the path and read permissions/);
    await assert.rejects(read("alias/not-yet/deleted.ts"), /Check the path and read permissions/);
    await assert.rejects(read("alias"), /regular file/);
    await assert.rejects(read("."), /regular file/);
  }
});

test("a symlink before `..` is followed as the OS follows it, for preview, download and placement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piano-climb-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const sibling = join(root, "sibling");
  await mkdir(join(repo, "src/deep"), { recursive: true });
  await mkdir(join(sibling, "sub"), { recursive: true });
  await writeFile(join(repo, "report.md"), "checkout copy\n");
  await writeFile(join(sibling, "report.md"), "sibling copy\n");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await symlink(join(sibling, "sub"), join(repo, "alias"));
  await symlink("src/deep", join(repo, "inner"));
  await symlink("a.ts", join(repo, "src/leaf.ts"));
  const real = await realpath(sibling);
  const workspace = { id: "scratch", folder: repo, path: repo };
  const read = (path: string) =>
    Effect.runPromise(
      readWorkspaceFile(workspace, path).pipe(Effect.mapError((error) => new Error(error.detail))),
    );
  const download = async (path: string) =>
    new TextDecoder().decode(
      (await Effect.runPromise(downloadWorkspaceFile(workspace, path))).bytes,
    );

  // What the OS opens is the sibling's file, so Piano previews and downloads that and names it.
  // Spelled by hand: `join` and `resolve` would collapse `alias/..` themselves.
  const absolute = `${repo}/alias/../report.md`;
  assert.equal(await readFile(absolute, "utf8"), "sibling copy\n");
  for (const path of ["alias/../report.md", absolute]) {
    assert.equal(await place(workspace, path), undefined, path);
    const preview = await read(path);
    assert.equal(preview.path, join(real, "report.md"));
    assert.ok("content" in preview);
    assert.equal(preview.content, "sibling copy\n");
    assert.equal(await download(path), "sibling copy\n");
  }
  // An alias that climbs back into the checkout stays inside, under the real name.
  assert.equal(await place(workspace, "inner/../a.ts"), "src/a.ts");
  assert.equal(await download("inner/../a.ts"), "export const a = 1;\n");
  assert.equal(await place(workspace, "inner/../leaf.ts"), "src/leaf.ts");
  assert.equal((await read("inner/../leaf.ts")).path, "src/leaf.ts");
  assert.equal(await place(workspace, "inner/../not-yet.ts"), "src/not-yet.ts");
  assert.equal(await place(workspace, "inner/.."), "src");
  // Without a symlink, `..` stays lexical; the explicit external path still reads.
  assert.equal(await place(workspace, "src/../report.md"), "report.md");
  assert.equal(await download("src/../report.md"), "checkout copy\n");
  assert.equal(await download("../sibling/report.md"), "sibling copy\n");
});

test("formats the previews promise are accepted under the detector's MIME variants", async () => {
  const a = await mkdtemp(join(tmpdir(), "piano-formats-"));
  try {
    const workspace = { id: "a", folder: a, path: a };
    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    // An ISO media file whose major brand is `M4A `, as iTunes and ffmpeg write it.
    const m4a = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypM4A \0\0\0\0M4A isom", "latin1"),
      Buffer.alloc(32),
    ]);
    // An Ogg page whose first packet is an Opus identification header.
    const opus = Buffer.concat([
      Buffer.from("OggS", "latin1"),
      Buffer.alloc(22),
      Buffer.from([1, 19]),
      Buffer.from("OpusHead", "latin1"),
      Buffer.alloc(32),
    ]);
    await writeFile(join(a, "voice.m4a"), m4a);
    await writeFile(join(a, "voice.opus"), opus);
    for (const [name, mime] of [
      ["voice.m4a", "audio/mp4"],
      ["voice.opus", "audio/ogg"],
    ]) {
      const audio = await read(name);
      assert.equal(audio.kind, "audio", name);
      assert.ok("mime" in audio);
      assert.equal(audio.mime, mime, name);
    }
    // Detected text formats are UTF-8 text, not unsupported binaries.
    for (const [name, content] of [
      ["captions.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"],
      ["meeting.ics", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"],
    ]) {
      await writeFile(join(a, name), content);
      assert.deepEqual(await read(name), {
        workspaceId: "a",
        path: name,
        kind: "text",
        language: "",
        content,
      });
    }
  } finally {
    await rm(a, { recursive: true, force: true });
  }
});

test("every name that claims a preview kind previews as that kind, so its icon matches", async () => {
  const a = await mkdtemp(join(tmpdir(), "piano-claims-"));
  try {
    const workspace = { id: "a", folder: a, path: a };
    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    const riff = (form: string) =>
      Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from(form)]);
    const ftyp = (brand: string) =>
      Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from(`ftyp${brand}\0\0\0\0${brand}isom`),
      ]);
    const ogg = (packet: string) =>
      Buffer.concat([
        Buffer.from("OggS"),
        Buffer.alloc(22),
        Buffer.from([1, packet.length]),
        Buffer.from(packet),
      ]);
    // The smallest header the detector recognizes for each format a name may claim.
    const samples: Record<string, Buffer> = {
      md: Buffer.from("# Notes\n"),
      markdown: Buffer.from("# Notes\n"),
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      png: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
      jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      gif: Buffer.from("GIF89a\x01\0\x01\0\0\0", "latin1"),
      webp: riff("WEBPVP8 "),
      mp3: Buffer.from([...Buffer.from("ID3"), 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]),
      wav: riff("WAVEfmt "),
      ogg: ogg("\x01vorbis"),
      oga: ogg("\x01vorbis"),
      opus: ogg("OpusHead"),
      flac: Buffer.from("fLaC\0\0\0\x22", "latin1"),
      m4a: ftyp("M4A "),
      mp4: ftyp("isom"),
      webm: Buffer.from("1a45dfa39f4282847765626d", "hex"),
      pdf: Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"),
    };
    assert.deepEqual(Object.keys(samples).sort(), Object.keys(previewKindsByExtension).sort());
    for (const [extension, bytes] of Object.entries(samples)) {
      const binary = !["md", "markdown", "svg"].includes(extension);
      for (const name of [`sample.${extension}`, `SAMPLE.${extension.toUpperCase()}`]) {
        await writeFile(join(a, name), binary ? Buffer.concat([bytes, Buffer.alloc(64)]) : bytes);
        assert.equal((await read(name)).kind, previewKindByName(name), name);
      }
    }
    // QuickTime is not a preview format, so its name claims nothing and its bytes are refused.
    await writeFile(join(a, "clip.mov"), Buffer.concat([ftyp("qt  "), Buffer.alloc(64)]));
    assert.equal(previewKindByName("clip.mov"), undefined);
    await assert.rejects(read("clip.mov"), /not supported/);
    // Neither a dotfile's name nor an inherited property claims a kind.
    for (const name of [".md", "notes.constructor", "Makefile", "a.b/README"])
      assert.equal(previewKindByName(name), undefined, name);
  } finally {
    await rm(a, { recursive: true, force: true });
  }
});

test("UTF-8 text whose first bytes match a short binary signature stays text", async () => {
  const a = await mkdtemp(join(tmpdir(), "piano-signatures-"));
  try {
    const workspace = { id: "a", folder: a, path: a };
    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    // BMP, DOS executable, MP3 and PDF signatures are two to five printable bytes.
    for (const [name, kind, language, content] of [
      ["bm25.md", "markdown", "markdown", "BM25 is a ranking function used by search engines.\n"],
      ["dos.txt", "text", "", "MZ is the DOS header of an executable.\n"],
      ["id3.md", "markdown", "markdown", "ID3 tags carry an MP3's title and artist.\n"],
      ["pdf.md", "markdown", "markdown", "%PDF-1.7 notes: the version line starts every PDF.\n"],
      // A multibyte character split by the 8 KiB header boundary is still UTF-8.
      ["split.md", "markdown", "markdown", `BM${"a".repeat(8191 - 2)}é\n`],
    ]) {
      await writeFile(join(a, name), content);
      assert.deepEqual(await read(name), { workspaceId: "a", path: name, kind, language, content });
    }
    // A real MP3 under a text name keeps its binary classification: its header holds NULs.
    const mp3 = Buffer.concat([
      Buffer.from("ID3", "latin1"),
      Buffer.from([4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]),
      Buffer.alloc(400),
    ]);
    await writeFile(join(a, "song.md"), mp3);
    const audio = await read("song.md");
    assert.equal(audio.kind, "audio");
    assert.ok("bytes" in audio);
    assert.deepEqual(audio.bytes, mp3);
  } finally {
    await rm(a, { recursive: true, force: true });
  }
});

test("a removed checkout refuses its files by that cause, and they read again once it returns", async () => {
  const root = await mkdtemp(join(tmpdir(), "piano-checkout-"));
  try {
    const a = join(root, "a");
    await mkdir(a);
    await writeFile(join(a, "readme.txt"), "workspace A\n");
    const workspace = { id: "a", folder: a, path: a };
    const refusal = <A>(effect: Effect.Effect<A, { detail: string }>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.flip,
          Effect.map((error) => error.detail),
        ),
      );
    await rename(a, join(root, "moved"));
    assert.equal(await refusal(readWorkspaceFile(workspace, "readme.txt")), "Checkout removed");
    assert.equal(await refusal(downloadWorkspaceFile(workspace, "readme.txt")), "Checkout removed");
    await rename(join(root, "moved"), a);
    const preview = await Effect.runPromise(readWorkspaceFile(workspace, "readme.txt"));
    assert.equal((preview as { content: string }).content, "workspace A\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
