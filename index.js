import { bindEvents, addPersonaButton } from "./src/ui/events.js";

jQuery(async () => {
    addPersonaButton(); 
    bindEvents(); 
    console.log("[PW] Persona Weaver loaded");
});
