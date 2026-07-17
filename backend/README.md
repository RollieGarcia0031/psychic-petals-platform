# Psychic Petals Platform - Backend

This directory contains the backend API service for **Psychic Petals**, a novel platform.

## Overview

The primary purpose of this backend is to provide a robust API service for saving, managing, and retrieving the content of the novel "Psychic Petals". 

The novel itself is maintained and versioned in its own dedicated GitHub repository:
[https://github.com/RollieGarcia0031/psychic-petals](https://github.com/RollieGarcia0031/psychic-petals).

This backend acts as the bridge between the storage/database layer (Firestore) and client applications (such as a frontend web reader). It handles the retrieval of episodes and chapters to be served to readers, as well as the saving of new content and updates to the novel's metadata.

## Documentation

For more information on how the novel data is structured and stored within our database, please refer to the database schema documentation:
- [Database Schema Documentation (Firestore)](./docs/DATABASE.md)
