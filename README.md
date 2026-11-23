# Fleet Grid AI

An original naval grid strategy game. Find and sink the computer's hidden fleet before it sinks yours. The strongest computer opponent aims with a probability heatmap you can watch.

**Live demo:** https://dustinclarence.github.io/fleet-grid-ai/

> **AI-assisted build.** This project was built with the help of an AI coding assistant (Claude) as a learning project for my portfolio.

## Features

- Three AI opponents: probability heatmap, hunt-and-target, random
- Toggle to show the AI's heatmap on your board
- Keyboard play with arrow keys
- In 30 simulated games the probability AI needed about 43 shots on average, versus about 96 for random shots

## AI techniques

Probabilistic search, constraint filtering, heuristics

## Built with

HTML, CSS and vanilla JavaScript. No frameworks, no build step and no external AI service. Everything runs in the browser.

## Run locally

Open `index.html` through any static server, for example:

```bash
npx serve .
```
