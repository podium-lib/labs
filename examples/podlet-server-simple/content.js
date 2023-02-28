import { html, css } from "lit";
import { PodiumPodletElement } from "@podium/experimental-lit-base-class";

export default class Content extends PodiumPodletElement {
  static styles = css`
    .demo {
      color: hotpink;
    }
  `;

  render() {
    return html`<section class="demo">This is a demo</section>`;
  }
}