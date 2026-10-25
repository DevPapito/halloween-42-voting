import {
  ArrayMinSize,
  IsArray,
  IsIn,
  MaxLength,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { VotingStatus } from './types.js';

export class SubmitPublicVoteDto {
  @IsString()
  @IsNotEmpty()
  deviceToken!: string;

  @IsUUID()
  candidateId!: string;
}

export class CandidateEvaluationItemDto {
  @IsUUID()
  candidateId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(15)
  creativityScore!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(15)
  executionScore!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  visualImpactScore!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  performanceScore!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  themeFidelityScore!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitJudgeEvaluationsDto {
  @IsUUID()
  judgeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CandidateEvaluationItemDto)
  evaluations!: CandidateEvaluationItemDto[];
}

export class JudgeLoginDto {
  @IsString()
  @IsNotEmpty()
  pinCode!: string;
}

export class CreateCandidateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  intranetLogin!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  studentName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  costumeName!: string;
}

export class CreateJudgeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class UpdateCandidateDto extends CreateCandidateDto {}

export class UpdateVotingStatusDto {
  @IsIn(['NOT_STARTED', 'OPEN', 'CLOSED'])
  status!: VotingStatus;
}
