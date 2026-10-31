import type { MindElixirInstance, Operation } from "mind-elixir";

/** The id of the editor Mind Elixir places over a node while its text is edited. */
const INPUT_BOX_ID = "input-box";

/** Operations that add a node and open it for editing immediately. */
const ADDING_OPERATIONS = new Set([ "addChild", "insertSibling" ]);

/**
 * Makes a map faster to write from the keyboard:
 *
 * - Typing a character on a selected node starts editing it and replaces its text, without F2 or a
 *   double-click. Keys handled by an input method (IME) compose into the node the same way.
 * - Tab while editing finishes the node and adds a child to edit next. Enter only finishes the node;
 *   a second Enter adds a sibling, as on any selected node.
 * - A newly added node opens empty instead of with `newTopicName` selected, and is removed again if
 *   editing ends while it is still empty (Escape, Enter or a click elsewhere).
 *
 * @param mind the map to enhance.
 * @param host the element the map was built in. Keys are handled there in the capture phase,
 *             because `mind.container` calls `preventDefault()` on every key it receives.
 * @param newTopicName the topic Mind Elixir gives new nodes; a node left empty keeps it.
 * @returns a function that removes the listeners.
 */
export function installQuickEditing(mind: MindElixirInstance, host: HTMLElement, newTopicName: string) {
    /** Nodes that were added and not yet written into, mapped to the node selected when added. */
    const freshNodes = new Map<string, string | undefined>();

    function onHostKeyDown(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null;
        if (!mind.editable || !target) return;

        if (target.id === INPUT_BOX_ID) {
            onEditorKeyDown(e, target);
        } else if (target === mind.container) {
            onMapKeyDown(e);
        }
    }

    function onMapKeyDown(e: KeyboardEvent) {
        if (mind.currentNodes.length !== 1 || mind.currentArrow || mind.currentSummary) return;

        const composing = isImeKey(e);
        if (!composing && !isPrintableKey(e)) return;

        e.stopPropagation();
        mind.beginEdit();
        const box = findInputBox(mind);
        if (!box) return;

        box.textContent = "";
        box.focus();
        // The IME composes into the focused element after `keydown`, which is now the editor.
        if (composing) return;

        e.preventDefault();
        box.textContent = e.key;
        placeCaretAtEnd(box);
    }

    function onEditorKeyDown(e: KeyboardEvent, box: HTMLElement) {
        if (isImeKey(e) || e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

        // Mind Elixir's own editor handler would finish the node and stop there.
        e.preventDefault();
        e.stopPropagation();

        const node = mind.currentNode;
        // An empty fresh node is removed on blur, so there is nothing to add a child to.
        if (!node || !box.innerText.trim()) return;

        box.blur();
        mind.container.focus();
        mind.addChild(node);
    }

    function onOperation(operation: Operation) {
        if (ADDING_OPERATIONS.has(operation.name) && "obj" in operation) {
            // The operation fires before the new node is selected.
            freshNodes.set(operation.obj.id, mind.currentNode?.nodeObj.id);
        } else if (operation.name === "beginEdit") {
            watchEditor(operation.obj.id);
        }
    }

    function watchEditor(nodeId: string) {
        const box = findInputBox(mind);
        if (!box) return;

        // `editTopic()` fires `beginEdit` before it registers its own blur listener, which writes the
        // text back unless it is empty or unchanged; ours must run after it. `insertSibling()` also
        // fires its operation after `beginEdit`, so whether the node is fresh is known only then.
        queueMicrotask(() => {
            if (!box.isConnected) return;
            if (freshNodes.has(nodeId)) {
                box.textContent = "";
            }

            box.addEventListener("blur", () => {
                if (!freshNodes.has(nodeId)) return;
                const originId = freshNodes.get(nodeId);
                freshNodes.delete(nodeId);

                const node = mind.findEle(nodeId);
                if (!node || node.nodeObj.topic !== newTopicName || node.nodeObj.children?.length) return;
                // Synchronous, so that a click that caused the blur still decides the selection.
                mind.removeNodes([ node ]);
                const origin = originId ? mind.findEle(originId) : undefined;
                if (origin) {
                    mind.selectNode(origin);
                }
            }, { once: true });
        });
    }

    host.addEventListener("keydown", onHostKeyDown, { capture: true });
    mind.bus.addListener("operation", onOperation);

    return () => {
        host.removeEventListener("keydown", onHostKeyDown, { capture: true });
        mind.bus.removeListener("operation", onOperation);
    };
}

/** Whether a key types a character. The space is excluded: Mind Elixir pans while it is held. */
export function isPrintableKey(e: KeyboardEvent) {
    return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** Whether a key is being handled by an input method (pinyin, kana and so on). */
export function isImeKey(e: KeyboardEvent) {
    return e.isComposing || e.key === "Process" || e.keyCode === 229;
}

function findInputBox(mind: MindElixirInstance) {
    return mind.nodes.querySelector<HTMLElement>(`#${INPUT_BOX_ID}`);
}

function placeCaretAtEnd(el: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}
