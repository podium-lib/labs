// Adds support for declarative shadow dom to Firefox and Safari
// This should be minimize and must be inlined directly after the server rendered custom element
if (!HTMLTemplateElement.prototype.hasOwnProperty('shadowRoot')) {
    const el = document?.currentScript?.previousElementSibling;
    /** @type {HTMLTemplateElement | null | undefined} */
    const template = el?.querySelector('template');
    const shadowRoot = template?.parentElement?.attachShadow({ mode: 'open' });
    if (template?.content) {
        shadowRoot?.appendChild(template?.content);
    }
}