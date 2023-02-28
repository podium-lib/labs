// @ts-ignore
import { LitElement } from "lit";
import i18next from "i18next";

export class PodiumPodletElement extends LitElement {
  #t;

  /**
   * Singleton initialiser for the translate function. A singleton is used to that SSR is supported since
   * typical setup hooks such as connectedCallback are not run server side. First call to the t() function
   * sets up i18next after which the setup version is then used.
   */
  get t() {
    if (!this.#t) {
      if (this.getAttribute("locale") && this.getAttribute("translations")) {
        i18next.init(
          {
            lng: this.getAttribute("locale") || '',
            debug: true,
            resources: JSON.parse(this.getAttribute("translations") || "{}"),
          },
          (err, t) => {
            if (err) {
              console.error(`Error initialising localisation`, err);
            }
            this.#t = t;
          }
        );
      } else {
        console.error('Missing necessary localisation files, unable to perform translation');
        this.#t = () => {};
      }
    }
    return this.#t;
  }

  /**
   * Retrieves initial state set by backend
   * @returns {object}
   */
  getInitialState() {
    try {
      // @ts-ignore
      return JSON.parse(this.getAttribute("initial-state") || "{}");
    } catch (err) {
      return {};
    }
  }
}
