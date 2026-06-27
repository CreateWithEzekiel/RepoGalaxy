# RepoGalaxy
Let’s be honest: staring at a massive, flat codebase is a great way to get a headache. So, I built a tool that takes your repo and explodes it into a 3D visual universe. It makes codebase onboarding, verification, and ideation feel less like homework and more like playing a video game.

### A Codex Skill that builds a 3D cartograph of your project, visualising the various files, functions, and codes in a 3D visual universe.
<img width="1918" height="1042" alt="image" src="https://github.com/user-attachments/assets/b0ac2ca8-5e55-41a1-a564-d484bcdf94e8" />
<img width="3835" height="2083" alt="image" src="https://github.com/user-attachments/assets/05422804-281a-4c97-a07b-85c9719b9862" />


### Why?
I code with Codex, and I really would like to understand deeply about what Codex has coded.  However, reading lines of code, figuring out how processes and functions relate to another, and then holding it all as context in my brain physically hurts.
Being able to see the entire architecture in a single view, and then navigating it spatially helps me connect the dots much faster.

---

# How are Nodes positioned spatially

<img width="1651" height="952" alt="image" src="https://github.com/user-attachments/assets/86cd2c4d-3d29-4910-9ab8-a5fd061e92bd" />

### Technique: **Bounded Structural Force Layout**

A deterministic spatial layout technique that uses structural affinity, relationship attraction, and bounded repulsion to shape the codebase graph into a readable architectural map while preserving the source-backed topology.
- Anchored hierarchy: Nodes are placed around their service, file, or declaration parent, giving the map a stable architectural frame.
- Structural affinity: Functions, APIs, contracts, UI elements, data objects, and other nodes are positioned around the files and parents they belong to.
- Relationship attraction: Connected nodes are pulled closer together based on the strength of their relationship.
- Collision repulsion: Nearby nodes push away from each other so the graph has more breathing room.
- Sibling repulsion: Unrelated nodes under the same parent are pushed apart, allowing smaller clusters to emerge.
- Adaptive bounds: Larger parent groups are given more space so dense areas do not collapse into tight clusters.
- Source-faithful layout: Positions are adjusted for readability, while the graph's nodes and relationships remain unchanged.

This helps architectural patterns, hidden dependencies, and local code clusters surface visually, making relationships easier to identify than they would be from reading source files alone.

---

# How information flows within connected Nodes
<img width="1654" height="949" alt="image" src="https://github.com/user-attachments/assets/9176f618-6d1e-4382-9e25-518bc31c06d1" />
<img width="1655" height="953" alt="image" src="https://github.com/user-attachments/assets/0a5b4adc-d041-43a3-ba58-21f39d5b860e" />
<br><br>
Clicking on any node would reveal the direction of information and where it is imported or gathered from. You could click on the next connected node and progressively explore the next.
Details of the selected nodes would also be displayed on the right panel, describing what it does, its input and output structure, and a semantic summary of it.

---

# Ask & Trace, Visualise any particular process
<img width="1652" height="950" alt="image" src="https://github.com/user-attachments/assets/168ba752-d544-4338-a8d5-1185b66c49c4" />
<br><br>
Ask Codex to explain something visually, and a narrow trace would be made selectable to view. Isolating unrelated nodes in any particular process within the codebase

---

# Fun Mode, Drive a Tesla Roadster in Space!
<img width="1652" height="950" alt="image" src="https://github.com/user-attachments/assets/d6abfe34-d3ad-4541-81c1-7fb1eedf4af6" />
<img width="1652" height="947" alt="image" src="https://github.com/user-attachments/assets/fb3141bb-c730-4d1c-b3db-8f07bb4aa671" />
<br><br>
Throwback reference to Elon Musk sending his Tesla Roadster to space, now you can drive one in your own spatial codebase universe.

---

# Install & Use
There are two skills, and they are a direct drop in for Codex

- $Codebase Index N Search
- $Codebase Cartographer

### Codebase Index N Search
It provides Python-only deterministic scripts that index a repository once into `.repo_executive_context/codebase_index_n_search` a subfolder within your project folder, query a SQLite-backed file/symbol/word/trigram/sparse-ngram/dependency/line index, refresh changed files on demand, prefer ACID-safe SQLite writes, fall back to guarded direct writes when needed, and read only narrow source slices. - Used by Codebase Cartographer as index reference to build the spatial maps for Python codes.

### Codebase Cartographer
Generate deterministic codebase graph artifacts and materialise a bundled local browser visualiser for Python, FastAPI, React, TypeScript, TSX, and CSS repositories. Use when Codex needs to map functions, components, API routes, schemas, styles, imports, calls, request/response contracts, evidence-backed service links, Obsidian notes, JSON Canvas files, Ask & Trace flows, or a localhost node graph without inventing source relationships.

### For Claude users, load the skill into your prompt and get it to convert it for Claude use.

---

# Tested with
- Python & React codes
