const libraryKey = "fridge-ideas-library-v1";

const pantryStaples = ["salt", "pepper", "olive oil", "water"];

const recipeBlueprints = [
  {
    type: "Fast skillet",
    title: "Craveable skillet hash",
    preferred: ["potato", "sweet potato", "onion", "pepper", "egg", "cheese", "sausage", "chicken"],
    fallback: ["onion", "garlic", "egg"],
    missing: ["onion", "eggs", "fresh herbs"],
    summary: (craving) => `A one-pan option with crispy edges and a ${craving || "comfort-food"} feel.`,
  },
  {
    type: "Bowl",
    title: "Fridge-clearing grain bowl",
    preferred: ["rice", "quinoa", "couscous", "chicken", "tofu", "beans", "spinach", "tomato", "avocado"],
    fallback: ["rice", "greens", "beans"],
    missing: ["rice", "lemon", "yogurt"],
    summary: (craving) => `A flexible bowl that layers your ingredients with a bright ${craving || "fresh"} finish.`,
  },
  {
    type: "Pasta or noodles",
    title: "Cozy pantry pasta",
    preferred: ["pasta", "noodles", "tomato", "cheese", "spinach", "mushroom", "chicken", "cream"],
    fallback: ["pasta", "garlic", "parmesan"],
    missing: ["pasta", "parmesan", "garlic"],
    summary: (craving) => `A saucy pasta-style meal tuned for a ${craving || "cozy"} craving.`,
  },
  {
    type: "Wrap",
    title: "Loaded fridge wrap",
    preferred: ["tortilla", "bread", "chicken", "turkey", "egg", "lettuce", "tomato", "cheese", "hummus"],
    fallback: ["tortillas", "greens", "sauce"],
    missing: ["tortillas", "crunchy lettuce", "sauce"],
    summary: (craving) => `A handheld meal with crisp, creamy, and ${craving || "satisfying"} bites.`,
  },
  {
    type: "Soup",
    title: "Simple simmer soup",
    preferred: ["broth", "carrot", "celery", "onion", "chicken", "beans", "noodles", "rice", "tomato"],
    fallback: ["broth", "onion", "carrot"],
    missing: ["broth", "carrots", "crusty bread"],
    summary: (craving) => `A low-effort soup for when you want something ${craving || "warming"}.`,
  },
];

const els = {
  form: document.querySelector("#recipe-form"),
  ingredients: document.querySelector("#ingredients-input"),
  craving: document.querySelector("#craving-input"),
  proposalGrid: document.querySelector("#proposal-grid"),
  proposalTemplate: document.querySelector("#proposal-template"),
  libraryList: document.querySelector("#library-list"),
  dictateButton: document.querySelector("#dictate-button"),
  voiceStatus: document.querySelector("#voice-status"),
  clearResultsButton: document.querySelector("#clear-results-button"),
  clearLibraryButton: document.querySelector("#clear-library-button"),
};

let activeProposals = [];
let recognition = null;

function normalizeToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function parseIngredients(value) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+|\band\b/gi)
        .map((item) => normalizeToken(item))
        .filter(Boolean),
    ),
  );
}

function ingredientMatches(ingredient, target) {
  return ingredient.includes(target) || target.includes(ingredient);
}

function availableMatches(ingredients, targets) {
  return targets.filter((target) => ingredients.some((ingredient) => ingredientMatches(ingredient, target)));
}

function missingItems(availableIngredients, candidates, usedItems) {
  const missing = candidates.filter(
    (item) => !availableIngredients.some((ingredient) => ingredientMatches(ingredient, item)) && !usedItems.includes(item),
  );

  return missing.length ? missing.slice(0, 3) : ["None needed"];
}

function scoreBlueprint(blueprint, ingredients, craving) {
  const usedCount = availableMatches(ingredients, blueprint.preferred).length;
  const cravingWords = normalizeToken(craving).split(/\s+/).filter(Boolean);
  const cravingBonus = cravingWords.some((word) => `${blueprint.type} ${blueprint.title}`.toLowerCase().includes(word)) ? 2 : 0;
  return usedCount * 3 + cravingBonus;
}

function generateProposals(userIngredients, craving) {
  const availableIngredients = [...userIngredients, ...pantryStaples];
  const sortedBlueprints = [...recipeBlueprints]
    .sort((left, right) => scoreBlueprint(right, availableIngredients, craving) - scoreBlueprint(left, availableIngredients, craving))
    .slice(0, 3);

  return sortedBlueprints.map((blueprint, index) => {
    const used = availableMatches(userIngredients, blueprint.preferred);
    const displayedUsed = used.length ? used : userIngredients.slice(0, 3);
    const missing = missingItems(availableIngredients, [...blueprint.missing, ...blueprint.fallback], displayedUsed);

    return {
      id: `${Date.now()}-${index}`,
      type: blueprint.type,
      title: blueprint.title,
      summary: blueprint.summary(craving.trim()),
      used: displayedUsed,
      missing,
      createdAt: new Date().toISOString(),
    };
  });
}

function loadLibrary() {
  return JSON.parse(localStorage.getItem(libraryKey) || "[]");
}

function saveLibrary(recipes) {
  localStorage.setItem(libraryKey, JSON.stringify(recipes));
}

function listItems(container, items) {
  container.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }),
  );
}

function renderProposal(recipe) {
  const fragment = els.proposalTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".recipe-card");
  const saveButton = fragment.querySelector(".save-button");

  fragment.querySelector(".recipe-type").textContent = recipe.type;
  fragment.querySelector("h3").textContent = recipe.title;
  fragment.querySelector(".recipe-summary").textContent = recipe.summary;
  listItems(fragment.querySelector(".used-list"), recipe.used);
  listItems(fragment.querySelector(".missing-list"), recipe.missing);

  saveButton.addEventListener("click", () => {
    const library = loadLibrary();
    if (!library.some((savedRecipe) => savedRecipe.title === recipe.title && savedRecipe.summary === recipe.summary)) {
      saveLibrary([recipe, ...library]);
    }
    saveButton.textContent = "Saved";
    saveButton.disabled = true;
    card.classList.add("saved");
    renderLibrary();
  });

  return fragment;
}

function renderProposals(proposals) {
  if (!proposals.length) {
    els.proposalGrid.innerHTML = `
      <article class="empty-state">
        <h3>Ready when you are.</h3>
        <p>Add ingredients and a craving to generate three starter recipes.</p>
      </article>
    `;
    return;
  }

  els.proposalGrid.replaceChildren(...proposals.map(renderProposal));
}

function renderLibrary() {
  const library = loadLibrary();

  if (!library.length) {
    els.libraryList.innerHTML = `
      <article class="empty-state compact">
        <h3>No saved recipes yet.</h3>
        <p>Save any proposal to keep it in this browser.</p>
      </article>
    `;
    return;
  }

  els.libraryList.replaceChildren(
    ...library.map((recipe) => {
      const article = document.createElement("article");
      const details = document.createElement("div");
      const type = document.createElement("p");
      const title = document.createElement("h3");
      const summary = document.createElement("span");
      const removeButton = document.createElement("button");

      article.className = "library-item";
      type.textContent = recipe.type;
      title.textContent = recipe.title;
      summary.textContent = recipe.summary;
      removeButton.className = "text-button danger";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        saveLibrary(loadLibrary().filter((savedRecipe) => savedRecipe.id !== recipe.id));
        renderLibrary();
      });

      details.append(type, title, summary);
      article.append(details, removeButton);
      return article;
    }),
  );
}

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    els.voiceStatus.textContent = "Voice input unavailable; text input works.";
    els.dictateButton.disabled = true;
    els.dictateButton.textContent = "Voice unavailable";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.addEventListener("start", () => {
    els.voiceStatus.textContent = "Listening for ingredients...";
    els.dictateButton.textContent = "Listening...";
  });

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(", ");
    els.ingredients.value = [els.ingredients.value.trim(), transcript].filter(Boolean).join(", ");
  });

  recognition.addEventListener("end", () => {
    els.voiceStatus.textContent = "Voice input ready.";
    els.dictateButton.textContent = "Dictate ingredients";
  });

  els.voiceStatus.textContent = "Voice input ready.";
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const ingredients = parseIngredients(els.ingredients.value);
  activeProposals = generateProposals(ingredients, els.craving.value);
  renderProposals(activeProposals);
});

els.dictateButton.addEventListener("click", () => {
  recognition?.start();
});

els.clearResultsButton.addEventListener("click", () => {
  activeProposals = [];
  renderProposals(activeProposals);
});

els.clearLibraryButton.addEventListener("click", () => {
  saveLibrary([]);
  renderLibrary();
});

setupVoiceInput();
renderLibrary();
