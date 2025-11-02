# Services

The plan is to construct the system using microservices.
This document describes an overall architecture.

## Ingestor

Firstly, users need to upload wallpapers. This can be its own microservice, called the 'ingestor'.
Its sole purpose is to take a wallpaper uploaded by a user, store it, and notify the rest of the system about it.

## Media

Users must retrieve wallpapers efficiently, the 'media' service exposes wallpapers efficiently to the user.
For animated, or live wallpapers, the media service exposes a thumbnail, and for images it exposes those as well.
Additionally, it might be able to handle resizing, and compression to reduce network load. 

## Thumbnail extractor

Users want to see a long list of wallpapers with minimal loading, transferring a whole video for live wallpapers every time is resource intensive, and unrealistic.
Instead, the 'thumbnail extractor' service extracts thumbnails for live and animated wallpapers.
This service provides these to the system.

## Gateway

A user can retrieve wallpapers, manage their own wallpapers, and several other things.
It's annoying from a UI perspective to talk to several microservices for this, so the 'gateway' service abstracts this. 

This service exposes a GraphQL API, and integrates with open search directly to expose information. It can also forward requests to different microservices.

## Quality Enrichment

The user wants to filter wallpapers by quality.
The 'quality enrichment' service extracts quality information from wallpapers, and provides this to the system.

## Color Enrichment

The user wants to filter wallpapers by color.
The 'color enrichment' service extracts color information from wallpapers, and provides this to the system.

## Tagging

The user wants to add tags to wallpapers and filter wallpapers by tags.
The 'tagging' service manage tags for wallpapers, and provides this to the system.
