# RepoGalaxy
Let’s be honest: staring at a massive, flat codebase is a great way to get a headache. So, I built a tool that takes your repo and explodes it into a 3D visual universe. It makes codebase onboarding, verification, and ideation feel less like homework and more like playing a video game.

### A Codex Skill that builds a 3D cartograph of your project, visualising the various files, functions, and codes in a 3D visual universe.
<img width="1918" height="1042" alt="image" src="https://github.com/user-attachments/assets/b0ac2ca8-5e55-41a1-a564-d484bcdf94e8" />

### Why?
I code with Codex, and I really would like to understand deeply about what Codex has coded.  However, reading lines of code, figuring out how processes and functions relate to another, and then holding it all as context in my brain physically hurts.
Being able to see the entire architecture in a single view, and then navigating it in a 3D spatial space helps me connect the dots much faster.

### How nodes are positioned spatially
Technique: **Bounded Structural Force Layout**

A deterministic spatial layout technique that uses structural affinity, relationship attraction, and bounded repulsion to shape the codebase graph into a readable architectural map while preserving the source-backed topology.
- Anchored hierarchy: Nodes are placed around their service, file, or declaration parent, giving the map a stable architectural frame.
- Structural affinity: Functions, APIs, contracts, UI elements, data objects, and other nodes are positioned around the files and parents they belong to.
- Relationship attraction: Connected nodes are pulled closer together based on the strength of their relationship.
- Collision repulsion: Nearby nodes push away from each other so the graph has more breathing room.
- Sibling repulsion: Unrelated nodes under the same parent are pushed apart, allowing smaller clusters to emerge.
- Adaptive bounds: Larger parent groups are given more space so dense areas do not collapse into tight clusters.
- Source-faithful layout: Positions are adjusted for readability, while the graph's nodes and relationships remain unchanged.
This helps architectural patterns, hidden dependencies, and local code clusters surface visually, making relationships easier to identify than they would be from reading source files alone.


<img width="1655" height="953" alt="image" src="https://github.com/user-attachments/assets/0a5b4adc-d041-43a3-ba58-21f39d5b860e" />
<img width="1652" height="950" alt="image" src="https://github.com/user-attachments/assets/168ba752-d544-4338-a8d5-1185b66c49c4" />
