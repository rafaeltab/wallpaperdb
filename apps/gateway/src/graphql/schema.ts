export const schema = `#graphql
	"""
	A wallpaper image or video
	"""
	type Wallpaper {
		"""
		Unique identifier for the wallpaper
		"""
		wallpaperId: ID!

		"""
		User who uploaded this wallpaper
		"""
		userId: String!

		"""
		Available variants (pre-generated sizes/formats)
		"""
		variants: [Variant!]!

		"""
		When the wallpaper was originally uploaded
		"""
		uploadedAt: String!

		"""
		When the wallpaper metadata was last updated
		"""
		updatedAt: String!
	}

	"""
	A specific size/format variant of a wallpaper
	"""
	type Variant {
		"""
		Width in pixels
		"""
		width: Int!

		"""
		Height in pixels
		"""
		height: Int!

		"""
		Aspect ratio (width / height)
		"""
		aspectRatio: Float!

		"""
		Image format (jpeg, png, webp)
		"""
		format: String!

		"""
		File size in bytes
		"""
		fileSizeBytes: Int!

		"""
		When this variant was created
		"""
		createdAt: String!

		"""
		URL to access this variant (computed field)
		"""
		url: String!
	}

	"""
	Filter options for searching wallpapers
	"""
	input WallpaperFilter {
		"""
		Filter by user ID
		"""
		userId: String

		"""
		Filter by variant properties
		"""
		variants: VariantFilter
	}

	"""
	Filter options for variant properties
	"""
	input VariantFilter {
		"""
		Filter by exact width
		"""
		width: Int

		"""
		Filter by exact height
		"""
		height: Int

		"""
		Filter by aspect ratio
		"""
		aspectRatio: Float

		"""
		Filter by format (jpeg, png, webp)
		"""
		format: String
	}

	"""
	An edge in a connection
	"""
	type WallpaperEdge {
		"""
		The wallpaper node
		"""
		node: Wallpaper!
	}

	"""
	Information about pagination in a connection
	"""
	type PageInfo {
		"""
		Whether there are more pages after this one
		"""
		hasNextPage: Boolean!

		"""
		Whether there are pages before this one
		"""
		hasPreviousPage: Boolean!

		"""
		Cursor to the first item in this page
		"""
		startCursor: String

		"""
		Cursor to the last item in this page
		"""
		endCursor: String
	}

	"""
	A connection to a list of wallpapers
	"""
	type WallpaperConnection {
		"""
		List of wallpaper edges
		"""
		edges: [WallpaperEdge!]!

		"""
		Pagination information
		"""
		pageInfo: PageInfo!
	}

	type Query {
		"""
		Search for wallpapers with optional filters and pagination
		"""
		searchWallpapers(
			"""
			Filter criteria
			"""
			filter: WallpaperFilter

			"""
			Number of items to return (forward pagination)
			"""
			first: Int

			"""
			Cursor to start after (forward pagination)
			"""
			after: String

			"""
			Number of items to return (backward pagination)
			"""
			last: Int

			"""
			Cursor to start before (backward pagination)
			"""
			before: String
		): WallpaperConnection!
	}
`;
