import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  at,
  courtRulerView,
  createInitialState,
  type RulerDocumentView,
} from "@throne/court";
import { createTranslator } from "@throne/localization";
import { CourtPlay, DeskDocument } from "./court-play.tsx";

const view = {
  ...courtRulerView(createInitialState("desk-test"), at(0, 6)),
  energy: 3,
};
const doc: RulerDocumentView = {
  id: "brief-1",
  kind: "brief",
  fromId: "yan_song",
  fromName: "严嵩",
  fromOffice: "内阁",
  subject: "浙江近况",
  text: "",
  arrivedAt: at(0, 6),
  folded: false,
  direct: false,
  opened: false,
};
const props = () => ({
  doc,
  view,
  choice: {
    disposition: "hold" as const,
    edict: { kind: "acknowledge" as const, params: {} },
    text: "",
  },
  expanded: false,
  onChange: vi.fn(),
  onReveal: vi.fn(),
  onOpen: vi.fn(),
  onToggle: vi.fn(),
  pending: false,
  locale: "zh-CN" as const,
  t: createTranslator("zh-CN"),
});

function rowButton(node: ReactNode): {
  disabled: boolean;
  onClick: () => void;
} {
  const found = findRowButton(node);
  if (found) return found;
  throw new Error("Missing inbox row button");
}
function findRowButton(
  node: ReactNode,
): ReturnType<typeof rowButton> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child))
      continue;
    if (
      child.type === "button" &&
      child.props.className === "court-inbox-toggle"
    )
      return child.props as unknown as ReturnType<typeof rowButton>;
    const found = findRowButton(child.props.children);
    if (found) return found;
  }
  return undefined;
}

describe("compact imperial desk", () => {
  it("renders one title row per message, sources, reading state and reply markers in both languages", () => {
    const documents: RulerDocumentView[] = [
      doc,
      {
        ...doc,
        id: "bureau",
        kind: "bureau",
        fromName: "通政司",
        subject: "外省杂事",
      },
      {
        ...doc,
        id: "memorial",
        kind: "memorial",
        hasDraft: true,
        subject: "赈济题本",
      },
      { ...doc, id: "secret", kind: "secret_memorial", subject: "浙江密奏" },
      {
        ...doc,
        id: "report",
        kind: "report",
        fromName: "陆炳",
        direct: true,
        opened: true,
        text: "原报正文",
        subject: "锦衣卫原报",
      },
    ];
    for (const locale of ["zh-CN", "en"] as const) {
      const t = createTranslator(locale);
      const html = renderToStaticMarkup(
        <>
          {documents.map((d) => (
            <DeskDocument
              {...props()}
              key={d.id}
              doc={d}
              locale={locale}
              t={t}
            />
          ))}
        </>,
      );
      expect(html.match(/role="listitem"/g)).toHaveLength(5);
      expect(html.match(/class="court-inbox-toggle"/g)).toHaveLength(5);
      expect(html.match(/class="court-inbox-reply"/g)).toHaveLength(2);
      expect(html.match(/aria-expanded="false"/g)).toHaveLength(5);
      for (const d of documents) expect(html).toContain(d.subject);
      expect(html).toContain(t("court.briefDirect"));
      expect(html).toContain(t("court.direct"));
      expect(html).toContain(t("court.read"));
      expect(html).toContain(t("court.unread"));
    }
  });

  it("requests opening an unread message, while read rows toggle without another opening", () => {
    const p = props();
    rowButton(DeskDocument(p)).onClick();
    expect(p.onOpen).toHaveBeenCalledOnce();
    expect(p.onToggle).toHaveBeenCalledOnce();
    const read = {
      ...p,
      doc: { ...doc, opened: true, text: "原文" },
      expanded: true,
      view: { ...view, energy: 0 },
    };
    const html = renderToStaticMarkup(<DeskDocument {...read} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
    expect(rowButton(DeskDocument(read)).disabled).toBe(false);
    rowButton(DeskDocument(read)).onClick();
    expect(p.onOpen).toHaveBeenCalledOnce();
    expect(p.onToggle).toHaveBeenCalledTimes(2);
    expect(
      renderToStaticMarkup(<DeskDocument {...read} expanded={false} />),
    ).toContain('hidden=""');
  });

  it("disables unread rows at zero energy or while pending, explaining the energy limit", () => {
    for (const p of [
      { ...props(), view: { ...view, energy: 0 } },
      { ...props(), pending: true },
    ]) {
      const button = rowButton(DeskDocument(p));
      expect(button.disabled).toBe(true);
      button.onClick();
      expect(p.onOpen).not.toHaveBeenCalled();
      expect(p.onToggle).not.toHaveBeenCalled();
      if (p.view.energy === 0)
        expect(renderToStaticMarkup(<DeskDocument {...p} />)).toContain(
          p.t("court.noEnergy"),
        );
    }
  });

  it("keeps unread draft disposal free and retains inline editing and legacy cards", () => {
    const p = props();
    const draft = {
      edict: { kind: "acknowledge" as const, params: {} },
      text: "拟请知道",
      draftedAt: at(0, 6),
    };
    const unread = renderToStaticMarkup(
      <DeskDocument
        {...p}
        doc={{ ...doc, kind: "memorial", hasDraft: true }}
        view={{ ...view, energy: 0 }}
      />,
    );
    expect(unread).toContain('class="court-inbox-disposition"');
    expect(unread).toContain('<option value="follow_draft">');
    expect(unread).toContain('<option value="hold" selected="">');
    const read = {
      ...doc,
      opened: true,
      folded: true,
      summary: "吕芳摘要正文",
      draft,
    };
    const edited = renderToStaticMarkup(
      <DeskDocument
        {...p}
        doc={read}
        expanded
        choice={{ ...p.choice, disposition: "custom", text: "亲笔朱批" }}
      />,
    );
    for (const text of [
      read.summary,
      draft.text,
      p.t("court.revealOriginal"),
      p.t("court.vermilion"),
      "亲笔朱批",
    ])
      expect(edited).toContain(text);
    const { energy: _energy, ...legacyView } = view;
    const legacy = renderToStaticMarkup(
      <DeskDocument
        {...p}
        doc={read}
        view={legacyView}
        choice={{ ...p.choice, disposition: "follow_draft" }}
      />,
    );
    expect(legacy).not.toContain("court-inbox");
    expect(legacy).not.toContain('hidden=""');
    expect(legacy).toContain('class="court-subject"');
    expect(legacy).toContain(p.t("court.vermilion"));
  });
});

it("new reigns allow free reading at zero energy and keep glosses and ponder results inside the expanded body", () => {
  const p = {
    ...props(),
    view: {
      ...view,
      settings: { register: "modern" as const, summaries: true },
      energy: 0,
    },
    onPonder: vi.fn(),
  };
  expect(rowButton(DeskDocument(p)).disabled).toBe(false);
  rowButton(DeskDocument(p)).onClick();
  expect(p.onOpen).toHaveBeenCalledOnce();
  const html = renderToStaticMarkup(
    <DeskDocument
      {...p}
      expanded
      doc={{
        ...doc,
        opened: true,
        text: "奏疏正文",
        gloss: "想找皇帝要钱",
        ponders: [{ at: at(0, 6), text: "朕得查查旧账" }],
      }}
    />,
  );
  expect(html).toContain("（想找皇帝要钱）");
  expect(html).toContain("朕得查查旧账");
  expect(html).toContain("深思 ·1");
  expect(html.indexOf("court-inbox-body")).toBeLessThan(
    html.indexOf("（想找皇帝要钱）"),
  );
});

it("renders the shared glossary as distinct term/definition rows in both languages", () => {
  for (const locale of ["zh-CN", "en"] as const) {
    const html = renderToStaticMarkup(
      <CourtPlay locale={locale} t={createTranslator(locale)} />,
    );
    expect(html.match(/<dt>/g)).toHaveLength(16);
    expect(html.match(/<dd>/g)).toHaveLength(16);
    expect(html).toContain("<dt>依拟</dt><dd>");
  }
});
