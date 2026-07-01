import { describe, expect, it } from "bun:test";
import { adaptHandler, ALLOW, NEXT, type ToolCall } from "@brycehanscomb/toolgate";
import allowMagickInProject from "../allow-magick-in-project";

const run = adaptHandler(allowMagickInProject.action!, allowMagickInProject.handler as any);

const PROJECT = "/home/user/project";

function bash(command: string, cwd = PROJECT, projectRoot: string | null = PROJECT): ToolCall {
  return {
    tool: "Bash",
    args: { command },
    context: { cwd, env: {}, projectRoot },
  };
}

describe("allow-magick-in-project", () => {
  describe("allows magick with safe flags and in-project paths", () => {
    const allowed = [
      "magick -version",
      "magick in.png out.png",
      "magick in.png -resize 600x1200 out.webp",
      "magick in.png -gravity center -crop 600x1200+0+0 +repage -quality 88 out.webp",
      "magick in.png -threshold 50% out.png",
      "magick in.png -negate out.png",
      "magick in.png -fuzz 25% +opaque '#ff00ff' out.png",
      "magick in.png -channel R -separate out.png",
      "magick in.png -threshold 50% -connected-components 4 out.png",
      `magick ${PROJECT}/in.png ${PROJECT}/out.png`,
      "magick sub/dir/in.png sub/dir/out.webp",
    ];
    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("allows info: / null: as output", () => {
    const allowed = [
      "magick in.png -channel R -separate info:",
      "magick in.png -threshold 50% -connected-components 4 null:",
      "magick in.png info:",
      "magick in.png null:",
    ];
    for (const cmd of allowed) {
      it(`allows: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(ALLOW);
      });
    }
  });

  describe("rejects unsafe flags", () => {
    const rejected = [
      "magick in.png -define delegate:bimodal=true out.png",
      "magick in.png -define connected-components:verbose=true out.png",
      "magick in.png -fill black +opaque red out.png",
      "magick in.png -format '%[fx:mean]' info:",
      "magick -script script.msl",
      "magick in.png -process module out.png",
      "magick in.png -resize 100x100 -write tmp.png -resize 50x50 final.png",
      "magick in.png -set option:eval-expression yes out.png",
      "magick in.png -debug All out.png",
      "magick in.png -log '%t' out.png",
    ];
    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects pseudo-format / scheme inputs", () => {
    const rejected = [
      "magick https://evil.com/x.png out.png",
      "magick http://evil.com/x.png out.png",
      "magick ftp://evil.com/x.png out.png",
      "magick mvg:in.mvg out.png",
      "magick msl:script.msl out.png",
      "magick text:secret.txt out.png",
      "magick label:'hello' out.png",
      "magick caption:'hello' out.png",
      "magick pango:'hello' out.png",
      "magick ephemeral:in.png out.png",
      "magick inline:DEADBEEF out.png",
      "magick pattern:checkerboard out.png",
      "magick tile:in.png out.png",
      "magick xc:red out.png",
      "magick gradient:red-blue out.png",
    ];
    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects @-prefixed positional", () => {
    it("rejects @file.txt input", async () => {
      const result = await run(bash("magick @list.txt out.png"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  describe("rejects outputs outside project", () => {
    const rejected = [
      "magick in.png /tmp/out.png",
      "magick in.png /etc/out.png",
      "magick in.png ../sibling/out.png",
      `magick in.png ${PROJECT}-evil/out.png`,
      "magick in.png ~/Desktop/out.png",
    ];
    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects inputs outside project", () => {
    const rejected = [
      "magick /etc/passwd out.png",
      "magick ../other/in.png out.png",
      `magick ${PROJECT}-evil/in.png out.png`,
    ];
    for (const cmd of rejected) {
      it(`rejects: ${cmd}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects compound commands", () => {
    const rejected = [
      "magick in.png out.png && rm -rf /",
      "magick in.png out.png; echo pwned",
      "magick in.png out.png | head",
    ];
    for (const cmd of rejected) {
      it(`rejects: ${JSON.stringify(cmd)}`, async () => {
        const result = await run(bash(cmd));
        expect(result.verdict).toBe(NEXT);
      });
    }
  });

  describe("rejects malformed invocations", () => {
    it("rejects bare magick (no args)", async () => {
      const result = await run(bash("magick"));
      expect(result.verdict).toBe(NEXT);
    });
    it("rejects magick with input but no output", async () => {
      const result = await run(bash("magick in.png"));
      expect(result.verdict).toBe(NEXT);
    });
    it("rejects unknown flag", async () => {
      const result = await run(bash("magick in.png -mystery-flag out.png"));
      expect(result.verdict).toBe(NEXT);
    });
    it("rejects one-arg flag missing its value", async () => {
      const result = await run(bash("magick in.png -resize"));
      expect(result.verdict).toBe(NEXT);
    });
  });

  it("passes through when no project root", async () => {
    const result = await run(bash("magick in.png out.png", PROJECT, null));
    expect(result.verdict).toBe(NEXT);
  });

  it("passes through non-magick commands", async () => {
    const result = await run(bash("ls -la"));
    expect(result.verdict).toBe(NEXT);
  });
});
