from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
	status: Literal["ok"]
	model_loaded: bool
	backend: Literal["cpu"]
	model: Literal["MobileSAM vit_t"]


class PrepareResponse(BaseModel):
	sessionId: str
	width: int = Field(ge=1)
	height: int = Field(ge=1)
	prepareMs: float = Field(ge=0)


class PointInput(BaseModel):
	x: float = Field(ge=0.0, le=1.0)
	y: float = Field(ge=0.0, le=1.0)
	label: Literal[0, 1]


class SegmentRequest(BaseModel):
	sessionId: str = Field(min_length=8, max_length=128)
	points: list[PointInput] = Field(min_length=1, max_length=64)


class SegmentCandidate(BaseModel):
	id: str
	score: float
	maskDataUrl: str
	width: int = Field(ge=1)
	height: int = Field(ge=1)


class SegmentResponse(BaseModel):
	sessionId: str
	recommendedIndex: int = Field(ge=0)
	candidates: list[SegmentCandidate]
	segmentMs: float = Field(ge=0)


class DeleteSessionResponse(BaseModel):
	status: Literal["deleted"]
	sessionId: str
