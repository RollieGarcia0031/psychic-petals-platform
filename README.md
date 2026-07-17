# Psychic Petals Platform

A dedicated full-stack platform and web reading experience for the open-source novel, [Psychic Petals](https://github.com/RollieGarcia0031/psychic-petals).

## Overview

The **Psychic Petals Platform** is a custom-built system designed to host, manage, and beautifully display the magical realism and slice-of-life novel, "Psychic Petals". This repository contains the complete architecture for the web platform, divided into a robust API backend and a modern, aesthetically pleasing frontend.

## 📖 The Story

While this repository contains the software platform, the original prose, outlines, and story bible of the novel itself are maintained and versioned in a separate, dedicated repository:

- **Story Repository:** [RollieGarcia0031/psychic-petals](https://github.com/RollieGarcia0031/psychic-petals)

## 🏗️ Architecture

This repository is structured as a monorepo with two main components:

### [Frontend](./frontend/)
A modern web application built with **Next.js**. It provides a fast, responsive, and immersive reading experience tailored specifically to the world of Psychic Petals. It consumes the backend API to dynamically render the novel's episodes and chapters.
- [Frontend Documentation](./frontend/README.md)

### [Backend](./backend/)
A robust API service acting as the bridge between the client applications and the Firestore database. It handles the secure storage, management, and retrieval of the novel's content and metadata.
- [Backend Documentation](./backend/README.md)
- [Database Schema](./backend/docs/DATABASE.md)

## 🚀 Getting Started

To run or contribute to this platform, please refer to the specific instructions in each component's directory:

- To run the web app locally, see the [Frontend README](./frontend/README.md).
- To set up the API and database connections, see the [Backend README](./backend/README.md).
