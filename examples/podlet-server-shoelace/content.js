import { html, css } from "lit";
import { PodiumElement } from "@podium/experimental-podium-element";

import rating from '@shoelace-style/shoelace/dist/components/rating/rating.js';
import button from '@shoelace-style/shoelace/dist/components/button/button.js';
import card from '@shoelace-style/shoelace/dist/components/card/card.js';
import styles from '@shoelace-style/shoelace/dist/styles/component.styles';
console.log(styles)

export default class Content extends PodiumElement {
  static styles = css`
    .demo {
      color: hotpink;
    }
  `;

  render() {
    return html`
    <sl-card class="card-footer">
    This card has a footer. You can put all sorts of things in it!
  
    <div slot="footer">
      <sl-rating></sl-rating>
      <sl-button variant="primary">Preview</sl-button>
    </div>
  </sl-card>
    `;
  }
}