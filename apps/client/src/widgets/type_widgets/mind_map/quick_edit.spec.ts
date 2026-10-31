import MindElixir, { type MindElixirInstance } from "mind-elixir";
import { afterEach, describe, expect, it } from "vitest";

import { installQuickEditing, isImeKey, isPrintableKey } from "./quick_edit";

const NEW_TOPIC = "New node";

let cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    document.body.replaceChildren();
});

function buildMap() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mind = new MindElixir({ el: host, editable: true, newTopicName: NEW_TOPIC, contextMenu: false, toolBar: false });
    mind.init({
        nodeData: { id: "root", topic: "Root", children: [ { id: "a", topic: "Alpha" } ] }
    });
    const uninstall = installQuickEditing(mind, host, NEW_TOPIC);
    cleanups.push(() => {
        uninstall();
        mind.destroy();
    });
    return mind;
}

function select(mind: MindElixirInstance, id: string) {
    const node = mind.findEle(id);
    expect(node).toBeTruthy();
    mind.selectNode(node);
    return node;
}

function inputBox(mind: MindElixirInstance) {
    return mind.nodes.querySelector<HTMLElement>("#input-box");
}

/** Ends editing the way a click elsewhere does. happy-dom fires `blur` only on a focused element. */
function leave(box: HTMLElement | null) {
    box?.focus();
    box?.blur();
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
}

async function settle() {
    await Promise.resolve();
}

describe("installQuickEditing", () => {
    it("starts editing a selected node when a character is typed, replacing its text", () => {
        const mind = buildMap();
        select(mind, "a");

        const event = press(mind.container, "x");

        const box = inputBox(mind);
        expect(box?.textContent).toBe("x");
        expect(event.defaultPrevented).toBe(true);

        leave(box);
        expect(mind.findEle("a").nodeObj.topic).toBe("x");
    });

    it("leaves shortcuts, the space and multiple selections to the map", () => {
        const mind = buildMap();
        select(mind, "a");

        press(mind.container, "c", { ctrlKey: true });
        press(mind.container, "v", { metaKey: true });
        press(mind.container, " ");
        expect(inputBox(mind)).toBeNull();

        mind.selectNodes([ mind.findEle("root"), mind.findEle("a") ]);
        press(mind.container, "x");
        expect(inputBox(mind)).toBeNull();
    });

    it("opens an empty, focused editor for an IME key and lets the IME write into it", () => {
        const mind = buildMap();
        select(mind, "a");

        const event = press(mind.container, "Process", { keyCode: 229 });

        const box = inputBox(mind);
        expect(box?.textContent).toBe("");
        expect(document.activeElement).toBe(box);
        expect(event.defaultPrevented).toBe(false);
    });

    it("opens a new node empty and removes it when editing ends with nothing written", async () => {
        const mind = buildMap();
        select(mind, "a");

        mind.addChild();
        await settle();
        const box = inputBox(mind);
        expect(box?.textContent).toBe("");
        expect(mind.findEle("a").nodeObj.children).toHaveLength(1);

        leave(box);
        expect(mind.findEle("a").nodeObj.children ?? []).toHaveLength(0);
        expect(mind.currentNode?.nodeObj.id).toBe("a");
    });

    it("keeps a new node once something is written into it", async () => {
        const mind = buildMap();
        select(mind, "a");

        mind.insertSibling("after");
        await settle();
        const box = inputBox(mind);
        expect(box?.textContent).toBe("");
        if (box) box.textContent = "Beta";
        leave(box);

        expect(mind.nodeData.children?.map((child) => child.topic)).toEqual([ "Alpha", "Beta" ]);
    });

    it("selects the node the removed one was added from", async () => {
        const mind = buildMap();
        select(mind, "a");

        mind.insertSibling("after");
        await settle();
        leave(inputBox(mind));

        expect(mind.nodeData.children).toHaveLength(1);
        expect(mind.currentNode?.nodeObj.id).toBe("a");
    });

    it("leaves an existing node named like a new one in place when its edit is canceled", () => {
        const mind = buildMap();
        const node = select(mind, "a");
        node.nodeObj.topic = NEW_TOPIC;

        mind.beginEdit();
        leave(inputBox(mind));

        expect(mind.findEle("a")).toBeTruthy();
    });

    it("finishes the node and adds a child to edit next on Tab", async () => {
        const mind = buildMap();
        select(mind, "a");
        press(mind.container, "Z");

        const box = inputBox(mind);
        expect(box).toBeTruthy();
        if (!box) return;
        const event = press(box, "Tab");
        await settle();

        expect(event.defaultPrevented).toBe(true);
        const alpha = mind.findEle("a").nodeObj;
        expect(alpha.topic).toBe("Z");
        expect(alpha.children).toHaveLength(1);
        expect(inputBox(mind)?.textContent).toBe("");
        expect(mind.currentNode?.nodeObj.id).toBe(alpha.children?.[0].id);
    });

    it("ignores Tab in an editor with nothing written", async () => {
        const mind = buildMap();
        select(mind, "a");
        mind.addChild();
        await settle();

        const box = inputBox(mind);
        expect(box).toBeTruthy();
        if (!box) return;
        press(box, "Tab");

        expect(inputBox(mind)).toBe(box);
        expect(mind.findEle("a").nodeObj.children).toHaveLength(1);
    });
});

describe("key classification", () => {
    it("tells characters, shortcuts and IME keys apart", () => {
        expect(isPrintableKey(new KeyboardEvent("keydown", { key: "a" }))).toBe(true);
        expect(isPrintableKey(new KeyboardEvent("keydown", { key: "中" }))).toBe(true);
        expect(isPrintableKey(new KeyboardEvent("keydown", { key: " " }))).toBe(false);
        expect(isPrintableKey(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
        expect(isPrintableKey(new KeyboardEvent("keydown", { key: "a", altKey: true }))).toBe(false);

        expect(isImeKey(new KeyboardEvent("keydown", { key: "Process" }))).toBe(true);
        expect(isImeKey(new KeyboardEvent("keydown", { key: "a", keyCode: 229 }))).toBe(true);
        expect(isImeKey(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
    });
});
