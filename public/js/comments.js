// comments.js — LaJugadaSegura00 (sistema de comentarios propio)
(function () {
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (children) for (const c of children) e.appendChild(c);
    return e;
  }
  function text(t) {
    return document.createTextNode(t);
  }
  function formatDate(ts, lang) {
    const d = new Date(ts);
    return d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  document.querySelectorAll("[data-comments-slug]").forEach(function (root) {
    const slug = root.getAttribute("data-comments-slug");
    const lang = root.getAttribute("data-comments-lang") || "en";
    const strings = lang === "es" ? {
      namePh: "Tu nombre", textPh: "Escribe tu comentario…",
      submit: "Enviar comentario", pending: "Gracias — tu comentario quedará visible tras revisión.",
      error: "No se pudo enviar. Inténtalo de nuevo.", empty: "Todavía no hay comentarios. Sé el primero.",
      loading: "Cargando comentarios…",
    } : {
      namePh: "Your name", textPh: "Write your comment…",
      submit: "Post comment", pending: "Thanks — your comment will appear after moderation.",
      error: "Couldn't submit. Please try again.", empty: "No comments yet. Be the first.",
      loading: "Loading comments…",
    };

    const form = el("form", { class: "comment-form" });
    const nameInput = el("input", { type: "text", placeholder: strings.namePh, maxlength: "60", required: "required" });
    const textInput = el("textarea", { placeholder: strings.textPh, maxlength: "2000", required: "required" });
    const hp = el("input", { type: "text", class: "hp", name: "website", tabindex: "-1", autocomplete: "off" });
    const submitBtn = el("button", { type: "submit", class: "comment-submit" }, [text(strings.submit)]);
    const status = el("div", { class: "comment-status" });

    form.appendChild(nameInput);
    form.appendChild(textInput);
    form.appendChild(hp);
    form.appendChild(submitBtn);
    form.appendChild(status);

    const list = el("div", { class: "comment-list" }, [el("p", { class: "comment-empty" }, [text(strings.loading)])]);

    root.appendChild(form);
    root.appendChild(list);

    function renderComments(comments) {
      list.innerHTML = "";
      if (!comments.length) {
        list.appendChild(el("p", { class: "comment-empty" }, [text(strings.empty)]));
        return;
      }
      comments.forEach(function (c) {
        const item = el("div", { class: "comment-item" });
        const author = el("div", { class: "comment-author" }, [
          text(c.name),
          el("span", { class: "comment-date" }, [text(formatDate(c.ts, lang))]),
        ]);
        const body = el("div", { class: "comment-text" }, [text(c.text)]);
        item.appendChild(author);
        item.appendChild(body);
        list.appendChild(item);
      });
    }

    function loadComments() {
      fetch("/api/comments?slug=" + encodeURIComponent(slug))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          renderComments((data && data.comments) || []);
        })
        .catch(function () {
          renderComments([]);
        });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitBtn.disabled = true;
      status.textContent = "";
      fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: slug,
          name: nameInput.value,
          text: textInput.value,
          website: hp.value,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          submitBtn.disabled = false;
          if (data && data.ok) {
            status.textContent = strings.pending;
            form.reset();
          } else {
            status.textContent = strings.error;
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          status.textContent = strings.error;
        });
    });

    loadComments();
  });
})();
